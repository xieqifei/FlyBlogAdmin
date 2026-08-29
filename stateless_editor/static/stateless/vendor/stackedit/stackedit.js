/*
 * stackedit.js v1.0.7, adapted from https://github.com/benweet/stackedit.js
 * Copyright (c) 2018 Benoit Schweblin, MIT License. See ./LICENSE.
 */
(function (global) {
    'use strict';

    var styleContent = [
        '.stackedit-no-overflow { overflow: hidden; }',
        '.stackedit-container { background-color: rgba(160,160,160,.5); position: fixed;',
        'top: 0; right: 0; bottom: 0; left: 0; z-index: 9999; }',
        '.stackedit-iframe-container { background: #fff; position: absolute; margin: auto;',
        'top: 0; right: 0; bottom: 0; left: 0; height: 98%; width: 98%;',
        'max-width: 1280px; border-radius: 2px; overflow: hidden; }',
        '.stackedit-iframe { position: absolute; height: 100%; width: 100%; border: 0; }',
        '.stackedit-close-button { position: absolute !important; width: 38px !important;',
        'height: 36px !important; margin: 4px !important; padding: 0 4px !important; }',
        '@media (max-width:740px) { .stackedit-iframe-container { height: 100%; width: 100%; } }'
    ].join('\n');
    var styleCreated = false;
    var origin = window.location.protocol + '//' + window.location.host;
    var urlParser = document.createElement('a');

    function createStyle() {
        if (styleCreated) return;
        var style = document.createElement('style');
        style.type = 'text/css';
        style.textContent = styleContent;
        document.head.appendChild(style);
        styleCreated = true;
    }

    function Stackedit(options) {
        this.options = { url: 'https://stackedit.io/app' };
        this.listeners = {};
        Object.assign(this.options, options || {});
        this.messageHandler = null;
        this.container = null;
    }

    Stackedit.prototype.on = function (type, listener) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(listener);
    };

    Stackedit.prototype.trigger = function (type, payload) {
        (this.listeners[type] || []).forEach(function (listener) {
            setTimeout(function () { listener(payload); }, 1);
        });
    };

    Stackedit.prototype.openFile = function (file) {
        var self = this;
        this.close();
        file = file || {};
        var content = file.content || {};
        urlParser.href = this.options.url;
        this.stackeditOrigin = urlParser.protocol + '//' + urlParser.host;
        var params = {
            origin: origin,
            fileName: file.name,
            contentText: content.text,
            contentProperties: content.yamlProperties || ''
        };
        urlParser.hash = '#' + Object.keys(params).map(function (key) {
            return key + '=' + encodeURIComponent(params[key] || '');
        }).join('&');

        createStyle();
        this.container = document.createElement('div');
        this.container.className = 'stackedit-container';
        this.container.innerHTML = [
            '<div class="stackedit-iframe-container">',
            '<iframe class="stackedit-iframe" title="StackEdit Markdown 编辑器"></iframe>',
            '<button type="button" class="stackedit-close-button" title="关闭">×</button>',
            '</div>'
        ].join('');
        document.body.appendChild(this.container);
        var iframe = this.container.querySelector('iframe');
        var closeButton = this.container.querySelector('button');
        iframe.src = urlParser.href;
        closeButton.addEventListener('click', function () { self.close(); });

        this.messageHandler = function (event) {
            if (event.origin !== self.stackeditOrigin || event.source !== iframe.contentWindow) return;
            if (event.data.type === 'ready') {
                closeButton.remove();
            } else if (event.data.type === 'fileChange') {
                self.trigger('fileChange', event.data.payload);
            } else if (event.data.type === 'close') {
                self.close();
            }
        };
        window.addEventListener('message', this.messageHandler);
        document.body.classList.add('stackedit-no-overflow');
    };

    Stackedit.prototype.close = function () {
        if (!this.messageHandler) return;
        window.removeEventListener('message', this.messageHandler);
        if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
        this.messageHandler = null;
        this.container = null;
        document.body.classList.remove('stackedit-no-overflow');
        this.trigger('close');
    };

    global.Stackedit = Stackedit;
}(window));
