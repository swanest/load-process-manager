var service = {},
    Q = require('q'),
    C = require('./constants'),
    util = require('./utilities'),
    debug = require('debug')('lpm:worker'),
    _ = require('underscore');


var healthReportTimer,
    ongoingRequests = [],
    softKillReceived = false;

service.on = util.on;
service.emit = function emitEvent(eventName, data) {
    if (eventName == void 0) {
        throw new Error('Events emitted to supervisor must be named');
    }
    debug('Emitting %s to supervisor with payload: %o', eventName, data);
    process.send({
        event: C.OTHER + eventName,
        data: data
    })
};
service.ready = function workerReady() {
    debug('Worker ready to execute tasks');
    healthReport();
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

process.on('message', function (payload) {
    // Pattern match LPM requests
    if (typeof payload.event !== 'string' ||
        payload.event.indexOf(C.NAMESPACE) === -1 ||
        (payload.event === C.REQUEST && typeof payload.id !== 'string')) {
        debug('Message not belonging to LPM: %o', payload);
        return;
    }

    switch (payload.event) {
        case C.REQUEST:
            var r = new Request(payload);
            ongoingRequests.push(r);
            util.trigger('request', r);
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
    }
    if (payload.event.indexOf(C.OTHER) > -1) {
        // Received a broadcast event
        util.trigger(payload.event.replace(C.OTHER, ''), payload.data);
    }
});

process.on('SIGINT', _.noop);

function killRoutine() {
    debug('Exiting process and stopping healthReports');
    clearTimeout(healthReportTimer);
    process.exit(0);
}

function Request(originalPayload) {
    var payload = originalPayload,
        that = this,
        responded = false;
    this.respond = function respond(d) {
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
        if (!cutOff) {
            throw new Error('Strangely we didnt find the request in the ongoing request array');
        }
        process.send({
            event: C.RESPONSE,
            id: payload.id,
            data: d
        });
        ongoingRequests.splice(cutOff, 1);
        responded = true;
        if (softKillReceived && ongoingRequests.length === 0) {
            killRoutine();
        }
        healthReport();
    };
    this.data = payload.data;
    this.id = payload.id;
    this.createdAt = payload.createdAt;
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