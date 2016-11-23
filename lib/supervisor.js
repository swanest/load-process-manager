var cluster = require("cluster"),
    _ = require("underscore"),
    uuid = require("uuid"),
    C = require("./constants"),
    debug = require('debug')('lpm:supervisor'),
    utils = require('./utilities'),
    Q = require('q'),
    net = require('net'),
    stream = require('stream'),
    through2 = require('through2'),
    server;

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

    var sp = {};
    var workers = [],
        requests = [],
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
                debug('Worker ready to work ' + worker.process.process.pid);
                worker.ready = true;
                worker.process.send({
                    event: C.DECLARE_PID,
                    pid: process.pid
                });
                if (!workersOnlineTriggered) {
                    checkIfAllWorkersReady();
                }
                break;
            case C.HEALTH:
                worker.health = msg.memoryUsage;
                break;
            case C.CLOSED_SOCKET:
                worker.handledSockets--;
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
                    req.response = msg;
                    if (typeof req.callback.original === 'function' && msg.hasStream !== true) {
                        req.callback.original(new Response(req));
                    }
                    if (msg.hasStream !== true) {
                        req.callback.defer.resolve(new Response(req));
                    }
                    clearTimeout(req.callback.timeout);
                    if (msg.hasStream !== true) {
                        worker.requests.splice(i, 1);
                    }
                    break;
                }
                break;
        }
        if (msg.event.indexOf(C.OTHER) > -1) { //From an emit
            utils.trigger(msg.event.replace(C.OTHER, ''), new Request(worker, msg));
        }
        if ([C.READY, C.RESPONSE].indexOf(msg.event) > -1) {
            spreadRequests();
        }
    };

    function Request(worker, originalPayload) {
        var payload = originalPayload,
            responded = false;
        this.respond = function respond(d) {
            if (responded) {
                throw new Error('You cannot reply twice to the same request (%s)', payload.id);
            }
            debug('Responding to request %s with %o and activating health reports', payload.id, d);
            worker.process.send({
                event: payload.event + payload.id,
                id: payload.id,
                data: d
            });
            responded = true;
        };
        this.data = payload.data;
        this.id = payload.id;
        this.pid = worker.process.process.pid;
        this.createdAt = payload.createdAt;
    }

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
            return w.process.process.pid !== worker.process.process.pid;
        });
        if (killing) {
            if (onSoftKilled != void 0 && workers.length === 0) {
                if (_.isFunction(onSoftKilled.callback))
                    onSoftKilled.callback();
                onSoftKilled.defer.resolve();
            }
            if (workers.length === 0) {
                process.exit(0);
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
        //worker.process.on('error', function () {
        //    console.log('got an error', arguments);
        //});
        //worker.process.on('disconnect', function () {
        //    console.log('worker disconnected', arguments);
        //});
        //worker.process.on('listening', function (address) {
        //    console.log('listening address', address);
        //});
        //worker.process.on('online', function (address) {
        //    console.log('worker online ', arguments);
        //});
    };

    function createWorker() {
        var newWorker = {
            process: cluster.fork(),
            createdAt: new Date(),
            leftRestarts: opts.worker.restarts,
            handledSockets: 0,
            requests: [],
            health: {rss: 0},
            ready: false
        };
        workers.push(newWorker);
        listen(newWorker);
        utils.trigger('childSpawned', newWorker);
        return newWorker;
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
            return w.requests.length === 0 && w.handledSockets === 0;
        });
        if (availableWorkers.length === 0) {
            availableWorkers = _.sortBy(workers, function (o) {
                return o.health.rss;
            });
        } else {
            availableWorkers = _.sortBy(availableWorkers, function (o) {
                return o.health.rss;
            });
        }
        var r = requests.shift(),
            w = _.first(availableWorkers);
        if (r.socket != void 0) {
            availableWorkers = _.chain(workers)
                .sortBy(function (o) {
                    return o.health.rss;
                })
                .sortBy(function (o) {
                    return o.handledSockets;
                })
                .value();
            w = _.first(availableWorkers);
            w.handledSockets++;
        }
        if (r.timeout != -1)
            r.callback.timeout = setTimeout(function () {
                r.callback.original(new Error(408, "Request timed out"));
                r.callback.defer.reject(new Error(408, "Request timed out"))
                w.requests = _.without(w.requests, {id: r.id});
            }, r.timeout);
        w.requests.push(r);
        debug('Request %s handled by %d worker', r.id, w.process.process.pid);

        var rModified = _.omit(r, 'callback', 'stream');
        rModified.stream = r.stream != void 0;
        rModified.socket = r.socket != void 0;
        w.process.send(rModified, r.socket || undefined);

        if (r.stream != void 0) {
            var begin = new Buffer('#B_' + r.id + '_B#TEST');

            var streamToChild = net.connect('/tmp/lpm-child-' + w.process.process.pid + '.sock');

            streamToChild.write(begin);

            r.stream
                .pipe(streamToChild);
        }
        spreadRequests();
    };


    //todo:
    sp.resize = function resize() {
    };


    // req is always an object, stream or socket can be passed as 2nd argument
    sp.enqueue = function enqueue(req, _handle, options, cb) {
        if (arguments.length < 4 && !(_handle instanceof net.Socket) && _handle != void 0 && !_.isFunction(_handle.pipe)) {
            cb = options;
            options = _handle;
        }
        if (cb == void 0) {
            cb = _.noop();
        }
        if (options == void 0) {
            options = {};
        }
        _.defaults(options, {
            timeout: opts.request.timeout,
            retries: opts.request.retries
        });
        var d = Q.defer();
        if (onSoftKilled != void 0) {
            debug('Process is dying, we dont accept any new request');
            cb(new Error(401, "Unauthorized request. Process is dying"));
            setTimeout(function () {
                d.reject(new Error(401, "Unauthorized request. Process is dying"));
            }, 0);
            return d.promise;
        }
        var construct = {
            event: C.REQUEST,
            id: uuid.v4(),
            data: req,
            createdAt: process.hrtime(),
            timeout: options.timeout,
            retries: options.retries,
            callback: {
                original: cb,
                defer: d
            }
        };
        if (_handle && _.isFunction(_handle.pipe) && !(_handle instanceof net.Socket)) {
            construct.stream = _handle;
        } else if (_handle instanceof net.Socket) {
            construct.socket = _handle;
        }
        requests.push(construct);
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
        server.close();
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
        server && _.isFunction(server.close) && server.close();
        //process.exit(0);
    };

    sp.on = utils.on;
    sp.once = utils.once;

    sp.broadcast = function broadcast(ev, data, _handle) {
        if (!(_handle instanceof net.Server)) {
            _handle = undefined;
        }
        workers.forEach(function (w) {
            w.process.send({event: C.OTHER + ev, data: data}, _handle);
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
        cluster.setupMaster({
            exec: opts.worker.file
        });
        for (var i = 0; i < opts.worker.count; i++)
            createWorker();

        initServer();
    };

    function Response(originalPayload) {
        var payload = originalPayload;

        this.data = payload.response.data;
        this.id = payload.id;
        this.createdAt = payload.createdAt;
        this.hasStream = payload.response.stream != void 0;
        if (this.hasStream) {
            this.stream = payload.response.stream;
        }
    }

    function initServer() {

        server = net.createServer(function (stream) {
            debug('New socket connection handled');

            var chunkIndex = 0,
                rIndex,
                wIndex;
            var modifiedStream = stream.pipe(through2(function (data, enc, cb) {
                var newData = data;
                if (chunkIndex === 0) {
                    var dToString = newData.toString('utf8'),
                        rid = dToString.match(/#B\_(.+?)\_B#/)[1];

                    var foundRequest;
                    for (var i = 0; i < workers.length; i++) {
                        for (var j = 0; j < workers[i].requests.length; j++) {
                            var cR = workers[i].requests[j];
                            if (cR.id !== rid) {
                                continue;
                            }
                            foundRequest = cR;
                            rIndex = j;
                            wIndex = i;
                            break;
                        }
                        if (foundRequest != void 0) {
                            break;
                        }
                    }
                    foundRequest.response.stream = modifiedStream;
                    if (_.isFunction(foundRequest.callback.original)) {
                        foundRequest.callback.original(new Response(foundRequest));
                    }
                    foundRequest.callback.defer.resolve(new Response(foundRequest));
                    newData = newData.slice(('#B_' + rid + '_B#').length);
                }
                chunkIndex++;
                cb(null, newData);
            }));
            modifiedStream.on('end', function () {
                workers[wIndex].requests.splice(rIndex, 1);
            });
        });

        debug('Net socket server listen on /tmp/lpm-parent-%d.sock', process.pid);
        server.listen('/tmp/lpm-parent-' + process.pid + '.sock');
    }

    return sp;
};
