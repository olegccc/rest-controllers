var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var bodyParser = require('body-parser');
var mimeTypes = require('mime-types');
const Promise = require('bluebird');

var ignoredMethods = {
    'constructor': true
};

_.each(Object.getOwnPropertyNames({}), function(method) {
    ignoredMethods[method] = true;
});

function getObjectMethods(obj) {

    var methods = {};

    _.forOwn(obj, function(value, key) {
        if (!ignoredMethods[key] && _.isFunction(value)) {
            methods[key] = true;
        }
    });

    _.each(Object.getOwnPropertyNames(Object.getPrototypeOf(obj)), function(key) {
        if (!ignoredMethods[key] && _.isFunction(obj[key])) {
            methods[key] = true;
        }
    });

    return _.keys(methods);
}

module.exports = function(app, options) {

    return new Promise((resolve, reject) => {
        options = options || {};
        var routes = [];
        var basePath = '';
        var controller = null;

        var router = {
            route: function(method, path, callback) {
                routes.push({
                    path: path,
                    method: method,
                    callback: _.bind(callback, controller),
                    base: basePath
                });
            },
            get: function(path, callback) {
                return this.route('GET', path, callback);
            },
            post: function(path, callback) {
                return this.route('POST', path, callback);
            },
            put: function(path, callback) {
                return this.route('PUT', path, callback);
            },
            delete: function(path, callback) {
                return this.route('DELETE', path, callback);
            }
        };

        var validFunctions = ['read', 'create', 'write', 'delete', 'remove'];

        var controllersPath = options.controllers || 'controllers';

        function actionToMethod(action) {
            switch (action) {
                case 'read':
                    return 'get';
                case 'write':
                    return 'put';
                case 'create':
                    return 'post';
                case 'remove':
                    return 'delete';
                default:
                    return action;
            }
        }

        function loadControllers(controllers) {

            _.each(controllers, function(controller, controllerName) {

                basePath = controllerName.replace('.', '/');

                controller.route && controller.route(router);

                var standardMethods = [];

                var methods = getObjectMethods(controller);

                _.each(methods, function(key) {

                    if (_.includes(['route'], key) || key.startsWith('_')) {
                        return;
                    }

                    if (_.includes(validFunctions, key)) {
                        standardMethods.push(key);
                        return;
                    }

                    var match = key.match(/^(read|write|create|delete|remove)([A-Z])(\w+)$/);

                    if (match) {
                        var method = actionToMethod(match[1]);
                        var name = match[2].toLowerCase() + match[3];
                        router[method](name, controller[key]);
                        return;
                    }

                    router.get(key, controller[key]);
                });

                _.each(standardMethods, function(key) {
                    var value = controller[key];
                    key = actionToMethod(key);
                    if (key === 'get') {
                        router[key](/^([0-9]+)$/, value);
                        if (options.noEmptyRead) {
                            return;
                        }
                        router[key](null, function(req, res) {
                            return value.call(this, null, req, res);
                        });
                    } else {
                        router[key](null, value);
                    }
                });

                basePath = '';
            });

            function handleReturnValue(res, returnValue) {

                if (_.isString(returnValue)) {

                    var filePath = path.join(options.resources || '', returnValue);

                    fs.exists(filePath, function(exists) {

                        if (!exists) {
                            res.set('Content-Type', 'text/plain');
                            res.send(returnValue);
                        } else {
                            fs.readFile(filePath, function(err, file) {
                                if (err) {
                                    res.sendStatus(500);
                                    return;
                                }

                                var contentType = mimeTypes.lookup(filePath);

                                if (contentType) {
                                    res.set('Content-Type', contentType);
                                }

                                res.send(file);
                            });
                        }
                    });

                    return;
                }

                if (_.isObject(returnValue)) {
                    res.set('Content-Type', 'application/json');
                    res.send(JSON.stringify(returnValue));
                }
            }

            function handleResponse(req, res, handler, match) {

                var args = [];

                if (match) {
                    args = _.concat(args, match);
                }

                if (req.method !== 'GET' && req.body) {
                    args.push(req.body);
                }

                args.push(req, res);

                var returnValue = handler.apply(null, args);

                if (returnValue && _.isFunction(returnValue.then)) {
                    returnValue.then(function(newReturnValue) {
                        handleReturnValue(res, newReturnValue);
                    });
                } else {
                    handleReturnValue(res, returnValue);
                }
            }

            options.debug && options.debug('Routes:', routes);

            app.all(options.route || /^(.+)$/, bodyParser.json(), function(req, res) {

                var query = req.params[0];

                options.debug && options.debug(req.method + ' ' + req.url + ' => ' + query);

                var handled = false;

                _.each(routes, function(route) {

                    if (_.isString(route.method)) {
                        if (route.method !== req.method) {
                            return;
                        }
                    } else if (_.isArray(req.method)) {
                        if (!_.includes(route.method, req.method)) {
                            return;
                        }
                    }

                    if (!route.path || _.isString(route.path)) {
                        var fullPath = route.base + (route.path ? ('/' + route.path) : '');
                        if (query === fullPath) {
                            handleResponse(req, res, route.callback, []);
                            handled = true;
                            return false;
                        }
                    }

                    if (!_.isRegExp(route.path)) {
                        return;
                    }

                    if (!query.startsWith(route.base + '/')) {
                        return;
                    }

                    var subQuery = query.substring(route.base.length+1);

                    var match = subQuery.match(route.path);

                    if (!match) {
                        return;
                    }

                    handleResponse(req, res, route.callback, _.drop(match));
                    handled = true;
                    return false;
                });

                if (!handled) {
                    options.notFoundHandler ?
                        options.notFoundHandler(req, res) :
                        res.sendStatus(404, 'Unknown Resource');
                }
            });

            options.done && options.done();
            resolve();
        }

        if (_.isObject(controllersPath)) {
            loadControllers(controllersPath);
        } else {

            var controllers = {};

            fs.readdir(controllersPath, function(err, files) {

                if (err) {
                    options.error && options.error(err);
                    reject(err);
                    return;
                }

                _.each(files, function (file) {

                    if (!file.endsWith('.js')) {
                        return;
                    }

                    var controllerName = file.substring(0, file.length - 3);
                    controller = require(path.resolve(path.join(controllersPath, controllerName)));
                    controllers[controllerName] = controller;
                });

                loadControllers(controllers);
            });
        }
    });
};
