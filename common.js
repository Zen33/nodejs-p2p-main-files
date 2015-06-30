/*
Peer 2 Peer Conversation client
tangzhen@me.com
2015/06/01 - 
*/
$(function() {
    var $contents = $('#contents'),
        $myWords = $('#myWords'),
        $sendMyWords = $('#sendMyWords'),
        $enQueueBtn = $('#enQueue'),
        $insertImageBtn = $('#insertImage'),
        $historyBtn = $('#records'),
        $endBtn = $('#end'),
        $evaluationWrapper = $('#evaluationWrapper'),
        $iframeWrapper = $('#disposal'),
        $qAndASection = $('.right-section'),
        $uploadForm,
        $evaluationForm = $('#evaluateForm'),
        currentId,
        isModernBrowser = (window.FileReader) ? true : false,
        talkTo = null,
        handshake = false,
        preview = new Image(),
        currentInsertedImages = [],
        cancelledImages = [],
        imgDefaultSize = { // 预览图片size
            width: 100,
            height: 80
        },
        robotName = 'ROBOT', // 机器人昵称
        matchedItemMaxNumber = 5, // 匹配问题显示最大数
        info = {
            tooFast: '请放慢速度。',
            disconnect: '服务器失去连接。',
            imageType: '请上传图片格式文件。（jpg/jpeg/gif/png）',
            noBody: '请确认当前正处于交谈状态。',
            noRecod: '当前没有历史消息。',
            weak: '请确认网络连接通畅。',
            welcome: '您好，有什么可以帮您？',
            askForCsr: '对答案不满意？可向“在线客服”寻求支持。',
            match: '找到了如下匹配的内容。',
            mismatching: '不太明白您的情况。',
            spaceLimited: '空间已满，请清理缓存。',
            timeout: '已经超时了。'
        },
        detectNewMsgProcess,
        originMsg = '',
        currentMsg = '',
        originTitle = document.title,
        checklocalStorage = function() { // 检测是否支持本地存储
            try {
                localStorage.setItem(test, 'test');
                localStorage.removeItem(test);
                return true;
            } catch (e) {
                return false;
            }
        },
        showPicture = function(data) { // 显示图片
            var content = $myWords.html().replace(/<br>/g, ''),
                rex = /<img[^>]+src="?([^"\s]+)"?[^>]*>/ig,
                src = rex.exec(data);
            $contents.find('.preview:last').remove();
            $myWords.html(content + data);
            $myWords.scrollTop($myWords[0].scrollHeight);
            currentInsertedImages.push(src[1]);
            $insertImageBtn.prop('disabled', false);
        },
        previewPicture = function(file, $form) { // 图片预览
            var fileName = file.value;
            if (!handshake) {
                return false;
            }
            if (!(/\.(gif|jpg|jpeg|png)$/i).test(fileName)) {
                setContents(info.imageType, 'system');
                return false;
            } else {
                var imgWidth,
                    imgHeight;
                $uploadForm.find('input[name="getter"]').val(talkTo);
                $contents.scrollTop($contents[0].scrollHeight);
                if (isModernBrowser) {
                    if (file.files && file.files[0]) {
                        var reader = new FileReader();
                        reader.onload = function(e) {
                            preview.src = e.target.result;
                            if (preview.width && imgWidth > imgDefaultSize.width) {
                                imgWidth = imgDefaultSize.width;
                                imgHeight = parseInt(400 * preview.height / preview.width);
                            } else {
                                imgWidth = imgDefaultSize.width;
                                imgHeight = imgDefaultSize.height;
                            }
                            $contents.find('.preview:visible').remove().end().append('<div class="preview" style="position:relative;"><img class="img" src="' + preview.src + '" width="' + imgWidth + '" height="' + imgHeight + '" border="0" /><div class="mask" style="position:absolute;left:0;top:0;width:' + imgWidth + 'px;height:' + imgHeight + 'px;">正在上载...</div></div>');
                            $insertImageBtn.prop('disabled', true);
                            $contents.scrollTop($contents[0].scrollHeight);
                            $form.submit();
                        }
                        reader.readAsDataURL(file.files[0]);
                    }
                } else {
                    var previewWrapper,
                        contents = '';
                    file.select();
                    file.blur();
                    imgWidth = imgDefaultSize.width;
                    imgHeight = imgDefaultSize.height;
                    // try {
                    contents = '<div class="preview" style="position:relative;"><div class="img"></div><div class="mask" style="position:absolute;left:0;top:0;width:' + imgWidth + 'px;height:' + imgHeight + 'px;">正在上载...</div></div>';
                    $contents.find('.preview:last').remove().end().append(contents);
                    previewWrapper = $contents.find('.preview:last .img')[0]; // ie8不支持visible，last替换之
                    previewWrapper.style.width = imgWidth + 'px';
                    previewWrapper.style.height = imgHeight + 'px';
                    previewWrapper.style.filter = 'progid:DXImageTransform.Microsoft.AlphaImageLoader(sizingMethod=scale)';
                    previewWrapper.filters.item('DXImageTransform.Microsoft.AlphaImageLoader').src = document.selection.createRange().text;
                    document.selection.empty();
                    $insertImageBtn.prop('disabled', true);
                    $contents.scrollTop($contents[0].scrollHeight);
                    // } catch (e) {
                    //     $contents.find('.preview:last').remove();
                    //     return false;
                    // }
                    $form.submit();
                }
            }
        },
        qAndA = function() { // 问题列表
            if (profile.robotContent && profile.robotContent.length) {
                var content = '<ul>';
                for (var i = 0, len = profile.robotContent.length; i < len; i++) {
                    if (profile.robotContent[i].hasOwnProperty('priority') && profile.robotContent[i].priority === 0) {
                        content += '<li class="item"><a href="' + profile.robotContent[i].url + '" target="_blank">' + profile.robotContent[i].content + '</a></li>';
                    }
                }
                $qAndASection.html(content + '</ul>');
                if (profile.role !== 'csr') {
                    // $myWords.prop('disabled', false);
                    $myWords.attr('contentEditable', true);
                    setContents(info.welcome, 'robot');
                }
            }
        },
        callRobot = function(keywords) { // robot互动
            if (profile.robotContent && profile.robotContent.length) {
                var content = '',
                    match = 0;
                for (var i = 0, len = profile.robotContent.length; i < len; i++) {
                    if (profile.robotContent[i].content.toLowerCase().indexOf(keywords.toLowerCase()) > -1) {
                        content += '<li class="item"><a href="' + profile.robotContent[i].url + '" target="_blank">' + profile.robotContent[i].content + '</a></li>';
                        match++;
                        if (match >= matchedItemMaxNumber) {
                            break;
                        }
                    }
                }
                if (match) {
                    content = info.match + '<br /><ul>' + content + '</ul><br />' + info.askForCsr;
                } else {
                    content = info.mismatching + '<br />' + info.askForCsr;
                }
                return content;
            }
        },
        setContents = function(data, type) { // 对话呈现
            var contents = '';
            if (type === 'system') {
                contents = '<div class="timeline-wrapper"><div class="system">' + data + '</div></div>';
            } else if (type === 'robot') {
                contents = '<div class="timeline-wrapper"><div class="robot"><div class="timeline-header"><label>' + robotName + '</label></div><div class="timeline-content">' + data + '</div></div></div>';
            } else {
                contents = '<div class="timeline-wrapper"><div class="' + data.role + '"><div class="timeline-header"><label>' + ((data.userName === profile.userName) ? '我' : (data.role === 'csr' ? '客服[' + data.userName + ']' : '客户[' + data.userName + ']')) + '：(' + data.time + ')</label></div><div class="timeline-content">' + data.message + '</div></div></div>';
            }
            // $contents.find('.system').hide();
            $contents.append(contents);
            // setTimeout(function () {
            //     $contents.find('.system').fadeOut();
            // }, 3000);
            $contents.scrollTop($contents[0].scrollHeight);
            // $contents.animate({ scrollTop: $contents[0].scrollHeight}, 1000);
        },
        // addHandler = function(obj, evnt, handler) {
        //     if (obj.addEventListener) {
        //         obj.addEventListener(evnt.replace(/^on/, ''), handler, false);
        //     } else {
        //         if (obj[evnt]) {
        //             var origHandler = obj[evnt];
        //             obj[evnt] = function(evt) {
        //                 origHandler(evt);
        //                 handler(evt);
        //             }
        //         } else {
        //             obj[evnt] = function(evt) {
        //                 handler(evt);
        //             }
        //         }
        //     }
        // },
        init = function() { // 初始化
            var $uploader,
                $iframe = $('<iframe name="mainFrame"/>').attr({
                    id: 'mainFrame',
                    src: 'about:blank',
                    style: 'display:none'
                }),
                formString = '<form id="imageForm" name="imageForm" action="/upload" method="post" enctype="multipart/form-data"><input type="hidden" name="setter" value="' + profile.userId + '" /><input type="hidden" name="getter" /><input type="file" id="thumbnail" name="thumbnail"/></form>';
            $iframe.prependTo($iframeWrapper);
            $iframeWrapper.append(formString);
            $uploadForm = $('#imageForm');
            $uploadForm.attr('target', 'mainFrame');
            $uploader = $('#thumbnail');
            // alert($('html').hasClass('ie8'))
            // if (isModernBrowser || !$('html').hasClass('ie8')) {
            if (isModernBrowser) {
                $insertImageBtn.click(function() {
                    $uploader.trigger('click');
                });
            } else {
                $uploader.css('cssText', 'progid:DXImageTransform.Microsoft.Alpha(Opacity=0);filter:alpha(opacity=0);opacity:0;position:absolute;width:' + ($insertImageBtn.width() + 5) + 'px;height:' + $insertImageBtn.height() + 'px;left:' + ($insertImageBtn.offset().left + 5) + 'px;top:' + ($insertImageBtn.offset().top + 5) + 'px');
            }
            $uploader.change(function() {
                $(this).prop('disabled', false);
                previewPicture(this, $uploadForm);
            });
            $iframe.load(function() {
                var data = $(this).contents().find('body').html();
                // currentPage = $(this).contents().get(0).location.href;
                if ($.trim(data) !== '') {
                    // if (/data:image.*base64/.test(data)) {
                    if (/<img.*?src=/i.test(data)) { // ie8 IMG
                        $uploadForm[0].reset();
                        showPicture(data);
                    } else {
                        $contents.find('.preview:last').remove();
                        $insertImageBtn.prop('disabled', false);
                        $uploader.prop('disabled', false);
                        $uploadForm[0].reset();
                        setContents(data, 'system');
                    }
                }
            });
            qAndA();
        },
        getDate = function(mark) { // 获得年月日
            var date = new Date(),
                mark = mark || '-';
            return date.getFullYear() + mark + (((date.getMonth() + 1) < 10) ? '0' : '') + (date.getMonth() + 1) + mark + ((date.getDate() < 10) ? '0' : '') + date.getDate();
        },
        getTime = function() { // 获得时分秒
            var date = new Date();
            return ((date.getHours() < 10) ? '0' : '') + date.getHours() + ':' + ((date.getMinutes() < 10) ? '0' : '') + date.getMinutes() + ':' + ((date.getSeconds() < 10) ? '0' : '') + date.getSeconds();
        },
        updateStatus = function(msg) { // 更新当前用户状态
            if (msg.indexOf('<!--1-->') > -1) {
                handshake = true;
                $endBtn.prop('disabled', false).show();
                $enQueueBtn.hide();
                $insertImageBtn.prop('disabled', false);
                // $myWords.attr('contentEditable', true);
                // $myWords.val('').prop('disabled', false);
                $historyBtn.prop('disabled', true);
            } else {
                handshake = false;
                $endBtn.prop('disabled', true).hide();
                $enQueueBtn.show();
                $insertImageBtn.prop('disabled', true);
                // $myWords.attr('contentEditable', false);
                // $myWords.val('').prop('disabled', true);
                $historyBtn.prop('disabled', false);
            }
        },
        save2Local = function() { // 消息本地存储
            if (checklocalStorage) {
                try {
                    localStorage.setItem(profile.userId, $contents.not('.record').html());
                } catch (e) {
                    setContents(info.spaceLimited, 'system');
                }
            }
        },
        escapeHtml = function(text) { // 字符集过滤
            var map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;'
            };
            return text.replace(/[&<>]/g, function(c) {
                return map[c];
            });
        },
        getTmpAssets = function(msg) { // 得到临时资源
            if (currentInsertedImages.length) {
                for (var i = 0, len = currentInsertedImages.length; i < len; i++) {
                    if (msg.indexOf(currentInsertedImages[i]) < 0) {
                        cancelledImages.push(currentInsertedImages[i]);
                    }
                }
            }
            return cancelledImages;
        },
        getSerializeObject = function($form) {
            var obj = {};
            var arr = $form.serializeArray();
            $.each(arr, function() {
                if (obj[this.name]) {
                    if (!obj[this.name].push) {
                        obj[this.name] = [obj[this.name]];
                    }
                    obj[this.name].push(this.value || '');
                } else {
                    obj[this.name] = this.value || '';
                }
            });
            return obj;
        },
        getStarted = function(data) { // 激活client端
            socket = io.connect();
            socket.emit('queue', {
                userId: data.userId,
                userName: data.userName,
                role: data.role,
                roleName: data.roleName
            });
            socket.on('queue', function(data) {
                talkTo = data.talkTo;
                currentId = data.id;
                setContents(data.message, 'system');
                updateStatus(data.message);
            });
            socket.on('end', function(data) {
                setContents(data, 'system');
                if (profile.role !== 'csr') {
                    $evaluationWrapper.show();
                    updateStatus(data);
                } else {
                    $endBtn.prop('disabled', true).hide();
                    $enQueueBtn.show();
                }
            });
            socket.on('evaluation', function(data) {
                if ($contents.find('.system:last').html().indexOf(data) > -1) {
                    updateStatus(data);
                }
            });
            socket.on('message', function(data) {
                currentMsg = data.message;
                setContents(data);
            });
            socket.on('disconnect', function() {
                setContents(info.disconnect, 'system');
            });
        };
    if (!isModernBrowser) {
        // addHandler(window, 'onerror', function (msg, url, num) {
        //     alert(msg);
        //     return true;
        // });
        var proxied = window.alert;
        window.alert = function() {
            setContents(info.weak, 'system');
            // return proxied.apply(this, arguments);
        };
        window.onerror = function(err) {
            alert(err);
            return true;
        };
    }
    init();
    $myWords.keydown(function(e) {
        if (e.keyCode === 13) {
            var msg = $(this).html(),
                data = {},
                currentTime = new Date().getTime(),
                tmpMsg = msg;
            e.preventDefault();
            if (!msg) return;
            if ($(this).data('timeInterval') && (currentTime - (+$(this).data('timeInterval')) < 1000)) {
                setContents(info.tooFast, 'system');
                $(this).empty();
                return;
            } else {
                $(this).data('timeInterval', currentTime);
            }
            // msg = msg.replace(/<(img[^>]+)>/ig, '⌘$1⌘').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            data = {
                time: getTime(),
                date: getDate(),
                userId: profile.userId,
                userName: profile.userName,
                role: profile.role,
                roleName: profile.roleName,
                filter: getTmpAssets(tmpMsg),
                // message: msg.replace(/⌘([^⌘]+)⌘/g, '<$1/>')
                // message: escapeHtml(msg).replace(/&lt;(img.*)&gt;/g, '<$1>')
                message: msg
            };
            if (handshake) {
                socket.emit('message', data);
                currentInsertedImages.length = 0;
                cancelledImages.length = 0;
                setContents(data);
                setTimeout(save2Local, 0);
                // $insertImageBtn.prop('disabled', false);
            } else {
                if (profile.role !== 'csr') {
                    setContents(data);
                    setContents(callRobot(msg), 'robot');
                }
            }
            $(this).empty();
        }
    });
    $sendMyWords.click(function() {
        if ($myWords.attr('contentEditable')) {
            var e = jQuery.Event('keydown');
            e.keyCode = 13;
            $myWords.focus();
            $myWords.trigger(e);
        }
    });
    $enQueueBtn.click(function() {
        if (!profile || $.isEmptyObject(profile)) return;
        $(this).prop('disabled', true).hide();
        getStarted(profile);
    });
    $historyBtn.click(function() {
        if (checklocalStorage) {
            var contents = localStorage.getItem(profile.userId);
            if (contents) {
                var recordString = '<div class="record">' + contents + '<div style="clear:both;">&nbsp;</div></div>'; // 适配ie8
                // $contents.find('.record').remove();
                $contents.empty();
                $contents.append(recordString);
                $contents.find('.record .system').hide();
                $contents.scrollTop($contents[0].scrollHeight);
            } else {
                setContents(info.noRecod, 'system');
            }
        }
    });
    $endBtn.click(function() {
        socket.emit('end', {
            userId: profile.userId,
            userName: profile.userName,
            role: profile.role,
            talkTo: talkTo,
            filter: getTmpAssets('')
        });
        $(this).prop('disabled', true).hide();
        $myWords.empty();
        $enQueueBtn.show();
    });
    $evaluationWrapper.find(':button').click(function(e) {
        if ($(e.target).hasClass('commit')) {
            if ($contents.find('.system:last').html().indexOf(info.disconnect) < 0) {
                var params = getSerializeObject($evaluationForm);
                params.id = currentId;
                params.userId = profile.userId;
                params.talkTo = talkTo;
                params.time = getTime();
                params.date = getDate();
                params.role = profile.role;
                $evaluationWrapper.find(':button').prop('disabled', true);
                $.post('/evaluate', params, function(data) {
                    if (data) {
                        $endBtn.prop('disabled', true).hide();
                        $enQueueBtn.show();
                    }
                    $evaluationWrapper.hide().find(':button').prop('disabled', false).end().find('form')[0].reset();
                });
            } else {
                $evaluationWrapper.hide().find('form')[0].reset();
                setContents(info.timeout, 'system');
            }
        } else {
            $evaluationWrapper.hide().find('form')[0].reset();
        }
    });
    $evaluationWrapper.find('textarea').on('keyup keydown parse', function(e) {
        if (e.type === 'parse') {
            e.preventDefault();
        } else {
            var limitNum = $(this).attr('maxLength') ? $(this).attr('maxLength') : 200,
                chineseRegex = /[^\x00-\xff]/g,
                newLen = 0,
                newStr = '',
                singleChar = '',
                strLen = this.value.replace(chineseRegex, '**').length;
            for (var i = 0; i < strLen; i++) {
                singleChar = this.value.charAt(i).toString();
                if (singleChar.match(chineseRegex) != null) {
                    newLen += 2;
                } else {
                    newLen++;
                }
                if (newLen >= limitNum) {
                    break;
                }
                newStr += singleChar;
            }
            this.value = newStr;
        }
    });
    $(window).blur(function() {
        detectNewMsgProcess = setInterval(function() {
            if (originMsg !== currentMsg) {
                document.title = document.title.length ? '' : '有新消息';
            }
        }, 300);
    }).focus(function() {
        clearInterval(detectNewMsgProcess);
        detectNewMsgProcess = 0;
        originMsg = currentMsg;
        document.title = originTitle;
    });
    $(window).on('beforeunload', function() {
        socket.emit('clear', {
            filter: getTmpAssets('')
        });
        $myWords.empty();
        // return '';
    });
    // window.onbeforeunload = function () {
    //     return '';
    // };
});