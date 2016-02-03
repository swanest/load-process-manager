var cp = require("child_process"),
    _ = require("underscore"),
    uuid = require("node-uuid"),
    C = require("./constants"),
    debug = require('debug')('lpm:supervisor'),
    utils = require('./utilities');


module.exports = function (opts) {

    if (opts == void 0)
        opts = {};
    if (opts.request == void 0)
        opts.request = {};
    _.defaults(opts.request, {
        timeout: -1,
        retries: 0
    });

    //opts.worker.file, opts.worker.count, opts.worker.restarts
    //opts.request.retries (-1 || positive number), opts.request.timeout (-1 || positive number ms)

    var sp = new Object();
    var workers = new Array(),
        requests = new Array,
        killing = false,
        workersOnlineTriggered = false;


    function handleMessage(worker, msg) {
        if (typeof msg.event !== 'string' ||
            msg.event.indexOf(C.NAMESPACE) === -1 ||
            (msg.event === C.REQUEST && typeof msg.id !== 'string')) {
            debug('Message not belonging to LPM: %o', msg);
            return;
        }
        switch (msg.event) {
            case C.READY:
                worker.reay = true;
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
                    clearTimeout(req.timeout);
                    worker.requests.splice(i, 1);
                    break;
                }
                break;
        }
        if (msg.event.indexOf(C.OTHER) > -1) {
            utils.trigger(msg.event.replace(C.OTHER, ''), msg.data);
        }
        spreadRequests();
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
        workers = _.without(workers, function (w) {
            return w.process.pid == worker.process.pid;
        });
        if (killing) {
            if (!workers.length) {
                if (worker.onKilled && _.isFunction(worker.onKilled.callback))
                    worker.onKilled.callback();
                if (worker.onKilled && _.isObject(worker.onKilled.defer))
                    worker.onKilled.defer.resolve();
            }
            return;
        }

        //If worker still accepts restarts, do it

        //Let's take all requests that enable retries, minus them, resend them

    };

    function listen(worker) {
        worker.process.on("message", function (msg) {
            return handleMessage(worker, msg);
        });
        worker.process.on("exit", function (code, signal) {
            return handleExit(worker, code, signal);
        });
    };

    function createWorker(config) {
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
        workers = _.filter(workers, function (v) {
            return v.ready == true;
        });
        if (!workers.length)
            return;
        workers = _.sortBy(( _.sortBy(workers, function (w) {
            return w.requests.length;
        })), 'health.rss');
        var r = requests.shift(),
            w = _.first(workers);
        if (r.timeout != -1)
            r.callback.timeout = setTimeout(function () {
                r.callback.original({status: 408, message: "Request timed out"});
                w.requests = _.without(w.requests, {id: r.id});
            }, r.timeout);
        w.requests.push(r), w.process.send(_.omit(r, "callback"));
    };


    //todo:
    sp.resize = function resize() {
    };


    sp.enqueue = function enqueue(req, cb, options) {
        var d = Q.defer();
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
            id: uuid.v1(),
            createdAt: process.hrtime(),
            timeout: options.timeout,
            retries: options.retries,
            callback: {
                original: cb,
                defer: d
            }
        });
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
            w.onKilled = {
                callback: cb,
                defer: d
            };
            w.process.send({event: C.SOFT_KILL});
        });
        return d.promise;
    };

    sp.hardKill = function hardKill() {
        killing = true;
        workers.forEach(function (w) {
            w.process.send({event: C.HARD_KILL});
        });
        process.exit(0);
    };

    sp.on = function on(ev, cb) {
        return utils.on(ev, cb);
    };

    sp.broadcast = function broadcast(ev) {
        workers.forEach(function (w) {
            w.process.send({event: C.OTHER + ev});
        });
    };

    for (var i = 0; i < opts.worker.count; i++)
        createWorker();

    return sp;
};
