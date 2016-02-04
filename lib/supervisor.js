var cp = require("child_process"),
    _ = require("underscore"),
    uuid = require("node-uuid"),
    C = require("./constants"),
    debug = require('debug')('lpm:supervisor'),
    utils = require('./utilities'),
    Q = require('q');

module.exports = function (opts) {

    if (opts == void 0)
        opts = {};
    if (opts.request == void 0)
        opts.request = {};
    if (opts.worker == void 0)
        opts.worker = {};
    _.defaults(opts.request, {
        timeout: -1,
        retries: 0
    });
    _.defaults(opts.worker, {
        count: 1,
        restarts: 5,
        maxRestartsInInterval: 120
    });

    if (!_.isString(opts.worker.file))
        throw new Error("worker file option missing");

    var sp = new Object();
    var workers = new Array(),
        requests = new Array,
        killing = false,
        workersOnlineTriggered = false,
        maxRestartsTimer,
        onSoftKilled;


    function handleMessage(worker, msg) {
        if (typeof msg.event !== 'string' ||
            msg.event.indexOf(C.NAMESPACE) === -1 ||
            (msg.event === C.REQUEST && typeof msg.id !== 'string')) {
            debug('Message not belonging to LPM: %o', msg);
            return;
        }
        switch (msg.event) {
            case C.READY:
                debug('Worker ready to work');
                worker.ready = true;
                if (!workersOnlineTriggered) {
                    checkIfAllWorkersReady();
                }
                break;
            case C.HEALTH:
                worker.health = msg.memoryUsage;
                break;
            case C.BUSY:
                worker.ready = false;
                break;
            case C.RESPONSE:
                for (var i = 0; i < worker.requests.length; i++) {
                    var req = worker.requests[i];
                    if (req.id !== msg.id) {
                        continue;
                    }
                    debug('Resolving %s with %o', msg.id, msg.data);
                    if (typeof req.callback.original === 'function') {
                        req.callback.original(msg.data);
                    }
                    req.callback.defer.resolve(msg.data);
                    clearTimeout(req.callback.timeout);
                    worker.requests.splice(i, 1);
                    break;
                }
                break;
        }
        if (msg.event.indexOf(C.OTHER) > -1) {
            utils.trigger(msg.event.replace(C.OTHER, ''), msg.data);
        }
        if ([C.READY, C.RESPONSE].indexOf(msg.event) > -1) {
            spreadRequests();
        }
    };

    function checkIfAllWorkersReady() {
        var allReady = true;
        workers.forEach(function (w) {
            if (w.ready !== true) {
                allReady = false;
            }
        });
        if (allReady) {
            workersOnlineTriggered = true;
            utils.trigger('online');
        }
    }

    function handleExit(worker, code, signal) {
        debug('Worker created on %s exited', worker.createdAt.toISOString());
        workers = workers.filter(function (w) {
            return w.process.pid !== worker.process.pid;
        });
        if (killing) {
            if (onSoftKilled != void 0 && workers.length === 0) {
                if (_.isFunction(onSoftKilled.callback))
                    onSoftKilled.callback();
                onSoftKilled.defer.resolve();
            }
            return;
        }

        if (worker.leftRestarts > 0) {
            debug('Recreating a worker because it died unexpectedly');
            var newWorker = createWorker();
            worker.leftRestarts--;
            newWorker.leftRestarts = worker.leftRestarts;
            clearTimeout(maxRestartsTimer);
            maxRestartsTimer = setTimeout(function () {
                worker.leftRestarts = opts.worker.restarts;
            }, opts.maxRestartsInInterval * 1000);
        }

        if (workers.length === 0) {
            sp.hardKill();
        }

        worker.requests.filter(function (d) {
            if (d.retries > 0) {
                d.retries--;
            }
            return d.retries > 0 || d.retries === -1;
        }).forEach(function (d) {
            requests.push(d);
        });
        spreadRequests();
    };

    function listen(worker) {
        worker.process.on("message", function (msg) {
            return handleMessage(worker, msg);
        });
        worker.process.on("exit", function (code, signal) {
            return handleExit(worker, code, signal);
        });
    };

    function createWorker() {
        workers.push({
            process: cp.fork(opts.worker.file),
            createdAt: new Date(),
            leftRestarts: opts.worker.restarts,
            requests: [],
            health: {rss: 0},
            ready: false
        });
        listen(_.last(workers));
        return _.last(workers);
    };


    function spreadRequests() {
        if (killing)
            return;
        if (!requests.length)
            return;
        debug('Spreading requests');
        var availableWorkers = _.filter(workers, function (v) {
            return v.ready;
        });
        debug('Available workers %d', availableWorkers.length);
        if (!availableWorkers.length) {
            debug('No worker available to take the task');
            return;
        }
        var availableWorkers = workers.filter(function (w) {
            return w.requests.length === 0;
        });
        if (availableWorkers.length === 0) {
            availableWorkers = _.sortBy(workers, 'health.rss')
        }
        var r = requests.shift(),
            w = _.first(availableWorkers);
        if (r.timeout != -1)
            r.callback.timeout = setTimeout(function () {
                r.callback.original({status: 408, message: "Request timed out"});
                w.requests = _.without(w.requests, {id: r.id});
            }, r.timeout);
        w.requests.push(r);
        debug('Request %s handled by %d worker', r.id, w.process.pid);
        w.process.send(_.omit(r, "callback"));
        spreadRequests();
    };


    //todo:
    sp.resize = function resize() {
    };


    sp.enqueue = function enqueue(req, cb, options) {
        var d = Q.defer();
        if (onSoftKilled != void 0) {
            debug('Process is dying, we dont accept any new requests');
            d.reject();
            return d.promise;
        }
        if (cb == void 0)
            options = cb;
        if (options == void 0)
            options = {};
        _.defaults(options, {
            timeout: opts.request.timeout,
            retries: opts.request.retries
        });
        requests.push({
            event: C.REQUEST,
            data: req,
            id: uuid.v4(),
            createdAt: process.hrtime(),
            timeout: options.timeout,
            retries: options.retries,
            callback: {
                original: cb,
                defer: d
            }
        });
        debug('Request added to queue');
        spreadRequests();
        return d.promise;
    };


    sp.health = function health() {
        return _.map(workers, function (w) {
            return _.extend({pid: w.pid}, w.health);
        });
    };


    sp.softKill = function softKill(cb) {
        killing = true;
        var d = Q.defer();
        workers.forEach(function (w) {
            w.process.send({event: C.SOFT_KILL});
        });
        onSoftKilled = {
            callback: cb,
            defer: d
        };
        return d.promise;
    };

    sp.hardKill = function hardKill() {
        killing = true;
        debug('%d workers in the system', workers.length);
        workers.forEach(function (w) {
            debug('Killing worker created on %s', w.createdAt.toISOString());
            w.process.send({event: C.HARD_KILL});
        });
        //process.exit(0);
    };

    sp.on = utils.on;

    sp.broadcast = function broadcast(ev, data) {
        workers.forEach(function (w) {
            w.process.send({event: C.OTHER + ev, data: data});
        });
    };

    process.on('SIGINT', function () {
        if (utils.hasListener('SIGINT')) {
            utils.trigger('SIGINT');
        } else {
            sp.hardKill();
        }
    });
    process.on('exit', function () {
        debug('Process exiting, lets kill children.');
        sp.hardKill();
    });

    sp.start = function start() {
        for (var i = 0; i < opts.worker.count; i++)
            createWorker();
    };

    return sp;
};
