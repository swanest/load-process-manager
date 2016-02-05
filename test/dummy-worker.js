process.on('uncaughtException', function (e) {
    console.log(e.stack);
});

process.on('unhandledException', function (e) {
    console.log(e.stack);
});

var worker = require('../index.js').worker;

var count = 0;

worker.on('request', function (req) {
    count++;
    console.log(req.data);
    setTimeout((function (count) {
        return function () {
            req.respond({coucou: 'toi', index: count});
        }
    })(count), 1000);
});
var t = '';
worker.ready();
//if (Math.random() > 0.6) {
//    setTimeout(function () {
//        console.log('Make worker busy');
//        worker.busy();
//    }, 1000);
//}

console.log(process.memoryUsage());

//worker.on('softKill', function (done) {
//    setTimeout(done, 2000);
//});