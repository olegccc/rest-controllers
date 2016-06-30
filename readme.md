# rest-controllers

The framework is to provide minimal REST controllers configuration for ExpressJS server.

## usage

Create directory to place all controllers (default is *[project root]/controllers*).

The controllers should follow simple convention:
* controller file name without extension will be the controller name

If controller has method
* read: then HTTP GET requests to *[controller name]* and *[controller name]/id* will be forwarded to this method
* write: then HTTP PUT requests to *[controller name]* will be forwarded to this method
* create: then HTTP POST requests to *[controller name]* will be forwarded to this method
* delete: then HTTP DELETE requests to *[controller name]* will be forwarded to this method
* started with underscore: such method will be ignored in routing
* for any method started with word 'read', 'write', 'create' and 'delete' and followed by capital letter the same convention will be used but the URL will be like *[controller name]/[method name without first word]* and first capital letter will be changed to lowercase, for example, *createDatabase* method of controller *manage.js* will handle POST requests to *manage/database*
* route: this method will be used during initialization to define custom rules. The method signature will be: *route(router)* where router object has a set of methods to define custom rules (see below); all routes definitions can accept
* all other method names will be considered as handling GET requests only

Each read method will get the following arguments:

```javascript
method(id, req, res);
```
where
* *req, res* are appropriate ExpressJS request and response objects

Each write/create/delete method will get the following arguments:

```javascript
method(body, req, res);
```
where
* *body* is the HTTP request body, parsed as JavaScript object if it is JSON
* *req, res* are appropriate ExpressJS request and response objects

Each GET method (last entry from the list above) will get no arguments.

Each method specified through route call will be defined as
```javascript
method(arg1, arg2, ... [, body], req, res);
```
where
* *arg1, arg2, ...* are regular exception groups if route defined through regular expression
* *body* (doesn't applicable for GET requests) is the HTTP request body, parsed as JavaScript object if it is JSON
* *req, res* are appropriate ExpressJS request and response objects

In case method return value contains:
* *object* - it will be returned as JSON response.
* *string* - the handler will try to treat it as path to resource file path and if it exists it will return appropriate file as response; otherwise it will return string as plain text response
* any other value - no additional response will be generated; the method should generate response by itself using 'res' object

## router API

Router object supports the following calls:
* route(method, path, callback)
* get(path, callback)
* post(path, callback)
* put(path, callback)
* delete(path, callback)

Where only first method does actual work and next four methods are shortcuts for appropriate HTTP methods.

*path* contains rule to check URL after "controller/" part. It can contain string or regular expression. If it is string, it will be joined with controller name and compared to the actual URL. For example, 'method' will be transferred to 'controller/method'. If it is regular expression, it will be used to compare the same URL part going after "controller/". If the expression has groups, they will be passed as arguments to the callback.
*callback* contains function to be called. The function will be called with 'this' set to the controller instance.

## examples

### simple controller

controllers/test.js
```javascript
module.exports = {
    read: function(id) {
        return 'abc';
    },
    write: function(body) {
        return {
            status: 'success'
        };
    }
};
```
In this case only these three requests will be handled:
* HTTP GET /test
* HTTP GET /test/id
* HTTP PUT /test

First two requests will return 'text/plain' response containing 'abc';
Last request will return JSON object containing {"status":"success"}

### controller with routing and complex functions

controllers/authenticate.js
```javascript

var database = ...;

module.exports = {
    route: function(router) {
        router.put(/^login\/(\w+)$/, this._handleLogin);
    },

    _database: database,

    _handleLogin: function(site, body) {
        // req and res are omitted as they are not used
        var user = this._database.getUser(site, body.username);
        return user;
    },

    createUser: function(body, req, res) {
        res.set('authId', 100);
        return this._database.createUser(body.userName);
    }
};
```
will create these two rules:
* *HTTP PUT /authenticate/login/sitename* where 'sitename' can be any text value with no spaces; will be handled by _handleLogin
* *HTTP POST /authenticate/user* will be handled by createUser function
