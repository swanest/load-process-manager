var cp = require("child_process"),
    _ = require("underscore"),
    uuid = require("node-uuid"),
    C = require("./constants");


module.exports = function (opts) {

    //opts.worker.file, opts.worker.count, opts.worker.restarts
    //opts.request.retries (-1 || positive number), opts.request.timeout (-1 || positive number ms)

    var sp = new Object();
    var workers = new Array(),
        requests = new Array,
        killing = false;


    function handleMessage(worker, msg) {
        //READY

        //HEALTH

        //OTHER

        //REQUEST -> find idRequest ? -> if yes, call cb, clear timeout, delete request

        //spread
    };

    function handleExit(worker, code, signal) {

        //worker = removeWorker()

        //If mode soft-kill, we do nothing if still workers alive, if all are killed, we kill supervisor

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
        r.callback.timeout = setTimeout(function () {
            r.callback.original({status: 408, message: "Request timed out"});
            w.requests = _.without(w.requests, {id: r.id});
        }, r.timeout);
        w.requests.push(r), w.process.send(_.omit(r, "callback"));
    };


    //todo:
    sp.resize = function resize() {};


    sp.enqueue = function enqueue(req, cb, timeout) {
        if (!timeout)
            timeout = opts.request.timeout;
        requests.push({
            event: C.REQUEST,
            data: req,
            id: uuid.v1(),
            createdAt: process.hrtime(),
            timeout: timeout,
            callback: {
                original: cb
            }
        });
        spreadRequests();
    };

    sp.health = function health() {

    };


    sp.softKill = function softKill(cb) {
        killing = true;
        workers.forEach(function(w){
            w.onKilled = cb;
            w.process.send({event: C.SOFT_KILL});
        });
    };

    sp.hardKill = function hardKill() {
        killing = true;
        workers.forEach(function(w){
            w.onKilled = cb;
            w.process.send({event: C.HARD_KILL});
        });
        process.exit(0);
    };

    sp.on = function on(ev, cb) {

    }; //ready,

    sp.broadcast = function broadcast(ev, cb) {
        //specific event
    };

    for (var i = 0; i < opts.worker.count; i++)
        createWorker();

    return sp;
};
