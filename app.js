/*
Peer 2 Peer Conversation server
tangzhen@me.com
2015/06/01 - 
*/
(function() {
    var express = require('express'),
        path = require('path'),
        app = express(),
        server = require('http').createServer(app),
        serverPort = 3000, // 默认port
        io = require('socket.io').listen(server),
        fs = require('fs'),
        accessLogfile,
        errorLogfile,
        sizeOf = require('image-size'), // 图片width/height/type
        ejs = require('ejs'),
        iconv = require('iconv-lite'), // 处理中文乱码
        mkdirp = require('mkdirp'),
        mysql = require('mysql'),
        config = require('./public/config/config.json'),
        activateLog = config.activateLog, // 是否激活日志
        mysqlConfig = config.mysqlConfig,
        tables = config.tables,
        imageMaxSize = 2, // 图片最大体积，单位mb
        imageMaxWidth = 400, // 图片显示最大宽度
        defaultScore = 3,
        timeout = 30,
        assetsPath = 'assets', // 资源存放目录（如果没有需要手动建立）
        pool, // mysql连接池
        currentQueue = [], // 队列
        clients = {}, // 客户
        csr = {}, // 客服
        assignedRole = { // 来自数据库表
            csr: ['ROLE_CUSTOMERSERVICE'],
            customer: ['ROLE_NORMALCUSTOMER', 'ROLE_ENTERPRISECUSTOMER']
        },
        role = config.role,
        status = config.status,
        noteItems = { // 信息反馈（花括号内数字勿改）
            client: {
                offline: '<!--{0}-->当前所有客服离线中，您位于队列第{1}位。',
                handshake: '<!--{0}-->客服[{1}]为您服务，现在可以交谈了。',
                busy: '<!--{0}-->当前坐席忙，您位于队列第{1}位。',
                retry: '<!--{0}-->由于连接中断，系统将为您尝试再次连接，{1}',
                bye: '<!--{0}-->感谢您的交谈，再见。',
                lost: '<!--{0}-->连接丢失。'
            },
            csr: {
                online: '<!--{0}-->上线成功。',
                lost: '<!--{0}-->与客户[{1}]中断了连接。',
                handshake: '<!--{0}-->与客户[{1}]交谈。',
                bye: '<!--{0}-->与客户[{1}]结束了交谈。'
            },
            system: {
                tooBig: '图片体积请控制在{0}MB以内。',
                guestUnknown: '未经确认的访客。',
                noRecord: '当前还没有跟对方交谈的历史纪录。',
                error: '服务器内部错误。'
            }
        },
        getNote = function(msg, args) { // 消息提示
            var len = args.length;
            args.forEach(function(val, index) {
                msg = msg.replace('{' + index + '}', val);
            });
            return msg;
        },
        checkCsrAllOffline = function(csr) { // 当前客服代表是否全部离线
            for (var i in csr) {
                if (csr.hasOwnProperty(i)) {
                    return false;
                }
            }
            return true;
        },
        adjustQueue = function(links) { // 清理队列中已经不存在的client
            var len = currentQueue.length;
            while (len--) {
                if (!links.hasOwnProperty(currentQueue[len])) {
                    currentQueue.splice(len, 1);
                }
            }
        },
        clone = function(obj) {
            return JSON.parse(JSON.stringify(obj));
        },
        getQueue = function(client, links, callback) { // 得到当前队列状况
            var available = false,
                result = '';
            if (checkCsrAllOffline(csr)) {
                if (client && currentQueue.indexOf(client.socket.id) < 0) {
                    currentQueue.push(client.socket.id);
                }
                try {
                    result = getNote(noteItems.client.offline, [status['enqueue'], (currentQueue.indexOf(client.socket.id) + 1)]);
                } catch (e) {
                    result = getNote(noteItems.client.lost, [status['disconnect']]);
                }
            } else {
                for (var i in csr) {
                    if (!csr[i].talkTo) {
                        result = getNote(noteItems.client.handshake, [status['handshake'], csr[i].userName]);
                        csr[i].talkTo = client.socket.id;
                        client.talkTo = csr[i].socket.id;
                        csr[i].toGrade = null;
                        available = true;
                        if (currentQueue.length) {
                            currentQueue.shift();
                        }
                        break;
                    }
                }
                if (!available) {
                    if (client && currentQueue.indexOf(client.socket.id) < 0) {
                        currentQueue.push(client.socket.id);
                    }
                    result = getNote(noteItems.client.busy, [status['enqueue'], (currentQueue.indexOf(client.socket.id) + 1)]);
                } else {
                    callback && callback();
                }
            }
            return result;
        },
        getCustomer = function(links) { // 得到队列中首个等候client
            var customer = null;
            adjustQueue(links);
            if (currentQueue.length && clients.hasOwnProperty(currentQueue[0])) {
                customer = clients[currentQueue[0]];
            }
            return customer;
        },
        refreshQueue = function() { // 刷新队列
            if (currentQueue.length) {
                currentQueue.forEach(function(val, index) {
                    clients[val] && clients[val]['socket'].emit('queue', {
                        talkTo: clients[val].talkTo ? csr[clients[val].talkTo].userId : null,
                        role: clients[val].role,
                        message: getNote(noteItems.client.busy, [status['enqueue'], (index + 1)])
                    });
                });
            }
        },
        updateQueue = function(client, links) { // 更新队列
            var index = 0,
                id = client.socket.id,
                msg = '',
                customer = null;
            // adjustQueue(links);
            if (client.role === role['csr']) { // 客服断线则当前client顺位队列第一位
                if (client.talkTo && clients.hasOwnProperty(client.talkTo)) {
                    customer = clients[client.talkTo];
                    currentQueue.unshift(client.talkTo);
                    customer.talkTo = null;
                }
                delete csr[id];
                msg = getNote(noteItems.client.retry, [status['dequeue'], getQueue(customer, links, refreshQueue).slice(8)]); // 8: <!--x-->
                customer && customer['socket'].emit('queue', {
                    talkTo: customer.talkTo ? csr[customer.talkTo].userId : null,
                    role: customer.role,
                    message: msg
                });
            } else {
                if (!client.talkTo) { // 当前离线用户正在排队
                    for (var i = 0, len = currentQueue.length; i < len; i++) {
                        if (currentQueue[i] === id) {
                            index = i;
                            break;
                        }
                    }
                    currentQueue.splice(index, 1);
                } else {
                    notifyCsr('<!--' + status['dequeue'] + '-->', client.talkTo, id);
                    for (var i in csr) {
                        if (csr[i].talkTo === id) {
                            csr[i].talkTo = null;
                            break;
                        }
                    }
                }
                delete clients[id];
                if (currentQueue.length) {
                    var customer = clients[currentQueue[0]],
                        msg = getQueue(customer, links, refreshQueue);
                    customer['socket'].emit('queue', {
                        talkTo: customer.talkTo ? csr[customer.talkTo].userId : null,
                        role: customer.role,
                        message: msg
                    });
                    notifyCsr(msg, client.talkTo, customer.socket.id);
                }
            }
        },
        notifyCsr = function(msg, csrId, clientId) { // 通知客服当前状况
            var id = csrId,
                client = clients[clientId];
            if (msg.indexOf('<!--' + status['dequeue'] + '-->') > -1) {
                csr[id]['socket'].emit('queue', {
                    talkTo: client.userId,
                    role: csr[id].role,
                    message: getNote(noteItems.csr.lost, [status['dequeue'], client.userName])
                });
            } else if (msg.indexOf('<!--' + status['handshake'] + '-->') > -1) {
                csr[id]['socket'].emit('queue', {
                    talkTo: client.userId,
                    role: csr[id].role,
                    message: getNote(noteItems.csr.handshake, [status['handshake'], client.userName])
                });
            }
        },
        handleDB = function(queryString, params, callback) { // 数据操作
            pool.getConnection(function(err, connection) {
                if (!!err) {
                    if (activateLog) {
                        var meta = '[' + new Date() + '] \n';
                        errorLogfile.write(meta + err.stack + '\n');
                    }
                    console.error('[Mysql query error]' + err.stack);
                    return;
                }
                connection.query(queryString, params, function(err, res) {
                    // connection.release();
                    pool.releaseConnection(connection);
                    // callback && callback(rows);
                    callback && callback.apply(null, [res, err]);
                    // connection.end();
                });
            });
        },
        fetchCsr = function(req, res, next) { // 得到客服
            var csrString = ''
            queryString = '';
            assignedRole.csr.forEach(function(val, index) {
                csrString += 'role="' + val + '" OR ';
            });
            if (csrString) {
                csrString = ' WHERE ' + csrString.slice(0, -4);
            }
            queryString = 'SELECT id,role,sex,user_name FROM ' + tables.users + csrString;
            handleDB(queryString, [], function(data) {
                req.params['csr'] = data;
                next();
            });
        },
        fetchUser = function(req, res, next) { // 得到访问者身份
            var queryString = 'SELECT * FROM ' + tables.users + ' WHERE id=' + req.params['userId'];
            handleDB(queryString, [], function(data) {
                if (data && data.length) {
                    req.params['roleName'] = data[0]['role'];
                    req.params['role'] = (assignedRole.csr.indexOf(data[0]['role']) > -1) ? 'csr' : 'customer';
                    req.params['userName'] = data[0]['user_name'];
                    req.params['csr'] = [];
                    fetchCsr(req, res, next);
                } else {
                    res.send(noteItems.system.guestUnknown);
                }
            });
        },
        saveEva2DBDefault = function(data, client) { // 默认评价
            var otherSide,
                queryString;
            if (client.role === role['csr']) {
                otherSide = clients[client.talkTo];
            } else {
                otherSide = csr[client.talkTo];
            }
            data.talkTo = otherSide.userId;
            queryString = 'INSERT INTO ' + tables.evaluate + '(id,eva_content,eva_advice,eva_create_tiem,eva_user_id,eva_cus_id) VALUES (0,"' + defaultScore + '","","' + data.date + ' ' + data.time + '","' + data.userId + '","' + data.talkTo + '"),(0,"' + defaultScore + '","","' + data.date + ' ' + data.time + '","' + data.talkTo + '","' + data.userId + '")';
            handleDB(queryString, []);
        },
        saveEva2DB = function(req, res, next) { // 实时评价
            var data = req.body,
                queryString = 'INSERT INTO ' + tables.evaluate + '(id,eva_content,eva_advice,eva_create_tiem,eva_user_id,eva_cus_id) VALUES (0,"' + data.score + '","' + data.advice + '","' + data.date + ' ' + data.time + '","' + data.userId + '","' + data.talkTo + '"),(0,"' + defaultScore + '","","' + data.date + ' ' + data.time + '","' + data.talkTo + '","' + data.userId + '")';
            handleDB(queryString, [], function() {
                req.params['theEnd'] = true;
                next();
            });
        },
        saveMsg2DB = function(data, otherId) { // 对话存库
            var queryString = 'INSERT INTO ' + tables.messages + '(chat_id,user_id,chat_content,chat_time,user_from,user_to) VALUES(0,?,?,?,?,?)',
                params = [data.userId, data.message, data.date + ' ' + data.time, data.userId, otherId];
            handleDB(queryString, params);
        },
        clearTmpAssets = function(items) { // 清理临时资源
            if (items && items.length) {
                items.forEach(function(val, index) {
                    fs.unlink(__dirname + '/' + assetsPath + val);
                });
            }
        },
        getDate = function(mark) { // 获得年月日
            var date = new Date(),
                mark = mark || '-';
            return date.getFullYear() + mark + (((date.getMonth() + 1) < 10) ? '0' : '') + (date.getMonth() + 1) + mark + ((date.getDate() < 10) ? '0' : '') + date.getDate();
        },
        getTime = function() { // 获得时分秒
            var date = new Date();
            return ((date.getHours() < 10) ? '0' : '') + date.getHours() + ':' + ((date.getMinutes() < 10) ? '0' : '') + date.getMinutes() + ':' + ((date.getSeconds() < 10) ? '0' : '') + date.getSeconds();
        };
    if (activateLog) {
        accessLogfile = fs.createWriteStream('./logs/access.log', {
            flags: 'a'
        });
        errorLogfile = fs.createWriteStream('./logs/error.log', {
            flags: 'a'
        });
    }
    // 创建mysql连接池
    pool = mysql.createPool(mysqlConfig);
    // 设置日志级别，将socket.io中的debug信息关闭
    io.set('log level', 1);
    // 开启监听
    io.sockets.on('connection', function(socket) {
        var id = socket.id,
            that = this,
            client = {
                socket: socket,
                userName: null,
                role: null,
                roleName: null,
                talkTo: null,
                userId: null,
                toGrade: null,
                status: 0
            };
        // 打印握手信息
        // console.log(socket.handshake);
        // 队列事件监听
        socket.on('queue', function(data) {
            client.userName = data.userName;
            client.userId = data.userId;
            client.roleName = data.roleName;
            client.role = data.role;
            that.connected[id].role = data.role;
            if (data.role === role['csr']) {
                var customer = getCustomer(that.connected);
                csr[id] = client;
                socket.emit('queue', {
                    talkTo: null,
                    role: client.role,
                    id: id,
                    message: getNote(noteItems.csr.online, [status['enqueue']])
                });
                if (customer) {
                    var msg = getQueue(customer, that.connected, refreshQueue);
                    customer['socket'].emit('queue', {
                        talkTo: client.userId,
                        id: customer.socket.id,
                        role: customer.role,
                        message: msg
                    });
                    notifyCsr(msg, id, customer.socket.id);
                }
            } else {
                var msg = getQueue(client, that.connected, refreshQueue);
                clients[id] = client;
                socket.emit('queue', {
                    talkTo: client.talkTo ? csr[client.talkTo].userId : null,
                    role: client.role,
                    id: id,
                    message: msg
                });
                notifyCsr(msg, client.talkTo, id);
            }
        });
        // 对话事件监听
        socket.on('message', function(data) {
            var otherSide;
            if (client.role === role['csr']) {
                otherSide = clients[client.talkTo];
            } else {
                otherSide = csr[client.talkTo];
            }
            otherSide['socket'].emit('message', data);
            clearTmpAssets(data.filter);
            saveMsg2DB(data, otherSide.userId);
        });
        // 失联事件监听
        socket.on('disconnect', function() {
            if ((!client.toGrade)) {
                var params = {};
                params.userId = client.userId;
                params.evaluation = null;
                params.time = getTime();
                params.date = getDate();
                params.role = client.role;
                saveEva2DBDefault(params, client);
            }
            updateQueue(client, that.connected);
        });
        // 清理临时资源监听
        socket.on('clear', function(data) {
            clearTmpAssets(data.filter);
        });
        // 结束对话监听
        socket.on('end', function(data) {
            var localSide,
                otherSide,
                currentCsr;
            if (client.role === role['csr']) {
                localSide = client;
                otherSide = clients[client.talkTo];
                client.toGrade = true;
                currentCsr = localSide;
                localSide['socket'].emit('end', getNote(noteItems.csr.bye, [status['disconnect'], otherSide.userName]));
                otherSide['socket'].emit('end', getNote(noteItems.client.bye, [status['disconnect']]));
                setTimeout(function() {
                    otherSide['socket'].disconnect();
                    localSide['socket'].emit('evaluation', '<!--' + status['handshake'] + '-->');
                }, timeout * 1000);
            } else {
                localSide = client;
                otherSide = csr[client.talkTo];
                otherSide.toGrade = true;
                currentCsr = otherSide;
                localSide['socket'].emit('end', getNote(noteItems.client.bye, [status['disconnect']]));
                otherSide['socket'].emit('end', getNote(noteItems.csr.bye, [status['disconnect'], localSide.userName]));
                setTimeout(function() {
                    localSide['socket'].disconnect();
                    otherSide['socket'].emit('evaluation', '<!--' + status['handshake'] + '-->');
                }, timeout * 1000);
            }
            clearTmpAssets(data.filter);
            if (currentQueue.length) {
                var customer = clients[currentQueue[0]],
                    msg = getQueue(customer, that.connected, refreshQueue);
                customer['socket'].emit('queue', {
                    talkTo: customer.talkTo ? csr[customer.talkTo].userId : null,
                    role: customer.role,
                    message: msg
                });
                notifyCsr(msg, currentCsr.socket.id, customer.socket.id);
            }
        });
    });
    // express配置
    app.configure(function() {
        app.set('port', process.env.PORT || serverPort);
        app.set('views', __dirname + '/views');
        app.engine('.html', ejs.__express);
        app.set('view engine', 'html'); // 启用html模板
        // app.use(express.favicon());
        if (activateLog) {
            app.use(express.logger({
                stream: accessLogfile
            }));
        } else {
            app.use(express.logger('dev'));
        }
        app.use(express.bodyParser({
            uploadDir: './' + assetsPath,
            keepExtensions: true,
            limit: imageMaxSize + 'mb'
        }));
        app.use(express.methodOverride());
        app.use(app.router);
        app.use(express.static(path.join(__dirname, 'public')));
        app.use(express.static(__dirname + '/' + assetsPath));
        app.use(function(err, req, res, next) {
            if (activateLog) {
                var meta = '[' + new Date() + '] ' + req.url + '\n';
                errorLogfile.write(meta + err.stack + '\n');
            }
            if (err.status === 413) {
                res.status(err.status).send(getNote(noteItems.system.tooBig, [imageMaxSize]));
            } else {
                res.status(500).send(noteItems.system.error);
            }
            // next(err);
        });
    });
    app.configure('development', function() {
        // app.use(express.errorHandler());
        app.use(express.errorHandler({
            dumpExceptions: true,
            showStack: true
        }));
    });
    // 指定客户端入口
    app.get('/', function(req, res) {
        res.send(noteItems.system.guestUnknown);
    });
    app.get('/:userId', fetchUser, function(req, res) {
        res.render('index', {
            profile: {
                userId: req.params['userId'],
                userName: req.params['userName'],
                role: req.params['role'],
                roleName: req.params['roleName'],
                csr: req.params['csr'],
                ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
            }
        });
    });
    app.post('/evaluate', saveEva2DB, function(req, res) {
        var result;
        if (req.params['theEnd']) {
            result = true;
        } else {
            result = false;
        }
        if (req.body['role'] === role['csr']) {
            for (var i in csr) {
                if (csr[i].userId === req.body['userId']) {
                    csr[i].toGrade = true;
                    break;
                }
            }
        } else {
            for (var i in clients) {
                if (clients[i].userId === req.body['userId']) {
                    clients[i].toGrade = true;
                    break;
                }
            }
        }
        res.send(result);
    });
    app.post('/upload', function(req, res) {
        var currentFile = req.files[Object.keys(req.files)[0]],
            imageInfo = sizeOf(currentFile.path),
            currentWidth = imageInfo.width,
            currentHeight = imageInfo.height,
            currentImageInfo = {},
            imageBase64StreamData = '',
            absolutePath = __dirname + '/' + assetsPath + '/' + req.body.setter,
            seed = new Date().getTime(),
            targetFileName = req.body.setter + '_' + req.body.getter + '_' + seed + '.' + imageInfo.type;
        if (imageInfo.width > imageMaxWidth) {
            currentHeight = parseInt(imageMaxWidth * currentHeight / currentWidth);
            currentWidth = imageMaxWidth;
        }
        mkdirp(absolutePath, function(err) {
            if (!!err) {
                res.send(err);
                return false;
            }
            fs.rename(currentFile.path, absolutePath + '/' + targetFileName, function(err) {
                if (!!err) {
                    res.send(err);
                    return false;
                }
                // res.redirect('/' + req.body.setter + '/' + targetFileName);
                res.send('<img src="/' + req.body.setter + '/' + targetFileName + '" width="' + currentWidth + '" height="' + currentHeight + '" border="0" />');
            });
        });
    });
    server.listen(app.get('port'), function() {
        console.log('Express server listening on port ' + app.get('port'));
    });
}());