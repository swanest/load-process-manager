var service = {},
    Q = require('q'),
    C = require('./constants'),
    util = require('./utilities'),
    debug = require('debug')('lpm:worker'),
    _ = require('underscore'),
    uuid = require("uuid"),
    through2 = require('through2'),
    net = require('net'),
    parentPID;


var healthReportTimer,
    ongoingRequests = [],
    softKillReceived = false;

service.on = util.on;
service.once = util.once;
service.emit = function emitEvent(eventName, data, cb) {
    var idEmit = uuid.v4();
    if (eventName == void 0) {
        throw new Error('Events emitted to supervisor must be named');
    }
    debug('Emitting %s to supervisor with payload: %o', eventName, data);
    process.send({
        event: C.OTHER + eventName,
        data: data,
        id: idEmit,
        createdAt: process.hrtime()
    });
    if (_.isFunction(cb))
        service.on(eventName + idEmit).then(function (responseData) {
            util.removeListeners(eventName + idEmit);
            cb(responseData);
        });
};
service.ready = function workerReady() {
    debug('Worker ready to execute tasks');
    healthReport();
    initServer();
    process.send({
        event: C.READY
    });
};
service.busy = function workerBusy() {
    process.send({
        event: C.BUSY
    });
};
service.requests = function requests() {
    return _.clone(ongoingRequests);
};

var server;
function initServer() {

    server = net.createServer(function (stream) {
        debug('Server connected');

        var chunkIndex = 0;
        var piped = stream
            .pipe(through2(function (data, enc, cb) {
                var newData = data;
                if (chunkIndex === 0) {
                    var dToString = newData.toString('utf8'),
                        rid = dToString.match(/#B\_(.+?)\_B#/)[1];
                    var foundRequest = _.findWhere(ongoingRequests, {id: rid});
                    foundRequest.stream = piped;
                    util.trigger('request', foundRequest);
                    newData = newData.slice(('#B_' + rid + '_B#').length);
                }
                chunkIndex++;
                cb(null, newData);
            }, function flush(cb) {
                cb();
            }));

        stream.on('end', function () {
            debug(process.pid + ' stream active connection closed');
        });
    });

    debug('Net socket server listen on /tmp/lpm-child-%d.sock', process.pid);
    server.listen('/tmp/lpm-child-' + process.pid + '.sock');
}


process.on('message', function (payload, sendHandle) {
    // Pattern match LPM requests
    if (typeof payload.event !== 'string' ||
        payload.event.indexOf(C.NAMESPACE) === -1 ||
        (payload.event === C.REQUEST && typeof payload.id !== 'string')) {
        debug('Message not belonging to LPM: %o', payload);
        return;
    }

    switch (payload.event) {
        case C.REQUEST:
            var r = new Request(payload, sendHandle);
            ongoingRequests.push(r);
            if (!r.hasStream) {
                util.trigger('request', r);
            }
            break;
        case C.SOFT_KILL:
            debug('Softkill received');
            softKillReceived = true;
            if (!util.hasListener('softKill') && ongoingRequests.length === 0) {
                killRoutine();
            } else {
                util.trigger('softKill', function () {
                    killRoutine();
                });
            }
            break;
        case C.HARD_KILL:
            util.trigger('hardKill');
            debug('Hard kill signal received');
            killRoutine();
            break;
        case C.DECLARE_PID:
            parentPID = payload.pid;
            debug('Received parent PID %d', parentPID);
            break;

    }
    if (payload.event.indexOf(C.OTHER) > -1) { // Received a broadcast event or a response to an emit
        if (sendHandle) {
            if (typeof payload.data != 'object') {
                var temp = {message: payload.data};
                payload.data = temp;
            }
            payload.data.handle = sendHandle;
        }
        util.trigger(payload.event.replace(C.OTHER, ''), payload.data);
    }
});

process.on('SIGINT', _.noop);

function killRoutine() {
    debug('Exiting process and stopping healthReports');
    clearTimeout(healthReportTimer);
    server && typeof server.close == 'function' && server.close();
    process.exit(0);
}

function Request(originalPayload, sendHandle) {
    var payload = originalPayload,
        that = this,
        responded = false;
    this.respond = function respond(d, stream) {
        if (responded) {
            throw new Error('You cannot reply twice to the same request (%s)', payload.id);
        }
        debug('Responding to request %s with %o and activating health reports', payload.id, d);
        var cutOff;
        for (var i = 0; i <= ongoingRequests.length; i++) {
            if (ongoingRequests[i] === that) {
                cutOff = i;
                break;
            }
        }
        if (cutOff == void 0) {
            throw new Error('Strangely we didnt find the request in the ongoing request array');
        }
        process.send({
            event: C.RESPONSE,
            id: payload.id,
            hasStream: stream != void 0,
            data: d
        });

        if (stream && _.isFunction(stream.pipe)) {
            var conToParent = net.connect('/tmp/lpm-parent-' + parentPID + '.sock');
            conToParent.write('#B_' + payload.id + '_B#');
            stream.pipe(conToParent);
        }

        ongoingRequests.splice(cutOff, 1);
        responded = true;
        if (softKillReceived && ongoingRequests.length === 0) {
            killRoutine();
        }
        healthReport();
    };
    this.ack = function ack() {
        that.respond();
    };
    this.data = payload.data;
    this.id = payload.id;
    this.createdAt = payload.createdAt;
    this.hasStream = payload.stream;
    this.hasSocket = sendHandle != void 0;
    this.socket = sendHandle;
    if (this.hasSocket) {
        this.socket.on('close', function () {
            process.send({
                event: C.CLOSED_SOCKET
            });
        });
    }
}

function healthReport() {
    if (healthReportTimer != void 0) {
        clearTimeout(healthReportTimer);
    }
    var req = {
        event: C.HEALTH,
        memoryUsage: process.memoryUsage()
    };
    process.send(req);
    healthReportTimer = setTimeout(healthReport, 500);
}

module.exports = service;