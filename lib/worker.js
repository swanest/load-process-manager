var service = {},
    Q = require('q'),
    C = require('./constants'),
    util = require('./utilities'),
    debug = require('debug')('lpm:worker'),
    _ = require('underscore');


var healthReportTimer = setTimeout(healthReport, 500);

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
    process.send({
        event: C.READY
    });
};

process.on('message', function (payload) {
    // Pattern match LPM requests
    if (typeof payload.event === 'string' &&
        payload.event.indexOf(C.NAMESPACE) > -1 &&
        typeof payload.id === 'string') {

        switch (payload.event) {
            case C.REQUEST:
                util.trigger('request', new Request(payload));
                break;
            case C.SOFT_KILL:
                if (!util.hasListener('softKill')) {
                    process.exit();
                } else {
                    util.trigger('softKill');
                }
                break;
            case C.HARD_KILL:
                util.trigger('hardKill');
                process.exit();
                break;
        }
        if (payload.event.indexOf(C.OTHER) > -1) {
            // Received a broadcast event
            util.trigger(payload.event.replace(C.OTHER, ''), payload.data);
        }
    }
});

process.on('SIGINT', _.noop);

function Request(originalPayload) {
    var payload = originalPayload;
    this.respond = function respond(d) {
        debug('Responding to request %s with %o', payload.id, d);
        process.send({
            event: C.RESPONSE,
            id: payload.id,
            data: d
        });
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
    debug('Emitting a health report to the supervisor with memory consumption of %o', req.memoryUsage);
    healthReportTimer = setTimeout(healthReport, 500);
}

module.exports = service;