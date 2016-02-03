var cp = require("child_process"),
    _ = require("underscore"),
    uuid = require("node-uuid");


module.exports = function(opts){

    //opts.worker.file, opts.worker.count, opts.worker.restarts
    //opts.request.retries, opts.request.timeout

    var sp = new Object();
    var workers = new Array(),
        requests = new Array();


    function listen(worker){
        worker.process.on("message", handlerMessage);
        worker.process.on("exit", handlerWorkerExits);
    };

    function createWorker(){
        workers.push({
            process:cp.fork(opts.worker.file),
            createdAt:new Date(),
            leftRestarts:opts.worker.restarts,
            requests: [],
            health: new Object(),
            totalRequests:0
        });
        listen(_.last(workers));
    };

    for(var i = 0; i < opts.worker.count; i++)
        createWorker();


    function spreadRequests(){

    };


    sp.resize = function resize(){};

    sp.enqueue = function enqueue(req,cb){
        requests.push({
            event:"request",
            data:req,
            id: uuid.v1(),
            createdAt: process.hrtime(),
            callback:cb
        });
        spreadRequests();
    };

    sp.health = function health(){};

    sp.softKill = function softKill(){};

    sp.hardKill = function hardKill(){};

    sp.on = function on(ev,cb){}; //ready,

    sp.broadcast = function broadcast(ev,cb){};


    return sp;
};
