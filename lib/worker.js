var service = {},
    Q = require('q'),
    C = require('./constants'),
    util = require('./utilities'),
    debug = require('debug')('lpm:worker'),
    _ = require('underscore');


var healthReportTimer,
    ongoingRequests = 0,
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
            ongoingRequests++;
            util.trigger('request', new Request(payload));
            break;
        case C.SOFT_KILL:
            debug('Softkill received');
            softKillReceived = true;
            if (!util.hasListener('softKill') && ongoingRequests === 0) {
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
    process.exit();
}

function Request(originalPayload) {
    var payload = originalPayload;
    this.respond = function respond(d) {
        debug('Responding to request %s with %o and activating health reports', payload.id, d);
        ongoingRequests--;
        process.send({
            event: C.RESPONSE,
            id: payload.id,
            data: d
        });
        if (softKillReceived && ongoingRequests === 0) {
            killRoutine();
        }
        healthReport();
    };
    this.data = payload.data;
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