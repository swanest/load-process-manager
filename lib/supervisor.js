var cp = require("child_process"),
    _ = require("underscore"),
    uuid = require("node-uuid");


module.exports = function(opts){

    //opts.worker.file, opts.worker.count, opts.worker.restarts
    //opts.request.retries, opts.request.timeout


    var sp = new Object();
    var workers = new Array();


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


    sp.resize = function(){};

    sp.enqueue = function(req,cb){};

    sp.health = function(){};

    sp.softKill = function(){};

    sp.hardKill = function(){};

    sp.on = function(ev,cb){};

    sp.broadcast = function(ev,cb){};

    
    return sp;
};
