var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var bodyParser = require('body-parser');
var mimeTypes = require('mime-types');

module.exports = function(app, options) {

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

    var validMethods = ['get', 'post', 'put', 'delete'];

    var controllersPath = options.controllers || 'controllers';

    fs.readdir(controllersPath, function(err, files) {

        if (err) {
            options.error && options.error(err);
            return;
        }

        _.each(files, function(file) {

            if (!file.endsWith('.js')) {
                return;
            }

            var controllerName = file.substring(0, file.length-3);
            controller = require(path.join(controllersPath, controllerName));
            basePath = controllerName.replace('.', '/');

            controller.route && controller.route(router);

            var standardMethods = [];

            _.forOwn(controller, function(value, key) {

                if (!_.isFunction(value) || _.includes(['route'], key) || key.startsWith('_')) {
                    return;
                }

                if (_.includes(validMethods, key)) {
                    standardMethods.push(key);
                    return;
                }

                var match = key.match(/^(read|write|create|delete)([A-Z])(\w+)$/);

                if (match) {
                    var method = match[1];
                    var name = match[2].toLowerCase() + match[3];
                    router[method](name, value);
                    return;
                }

                router.get(key, value);
            });

            _.each(standardMethods, function(key) {
                var value = controller[key];
                if (key === 'read') {
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

                            var contentType = mimeTypes(filePath);

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

            if (req.body) {
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
    });
};
