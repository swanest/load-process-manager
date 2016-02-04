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
if (Math.random() > 0.6) {
    console.log('eating memory');
    for (i = 0; i < 1000000; i++) {
        t += 'bqeuifgqlizeuuiqlzfbeilquzqjfbqeuifgqlizeuuiqlzfbeilquzqjfbqeuifgqlizeuuiqlzfbeilquzqjfbqeuifgqlizeuuiqlzfbeilquzqjfbqeuifgqlizeuuiqlzfbeilquzqjfbqeuifgqlizeuuiqlzfbeilquzqjfbqeuifgqlizeuuiqlzfbeilquz';
    }
}

console.log(process.memoryUsage());

//worker.on('softKill', function (done) {
//    setTimeout(done, 2000);
//});

worker.ready();