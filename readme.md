# Open-Polymer-Tester

Provides the `opt` server and test runner.

## `serverMappings.json`

To correctly host files, you need to provide mappings between the url paths and the actual folder paths.
This is will vary depending on your project, but a sample below is provided:

- `rootPaths`: paths that should show up at the root of the server
- `mappings`: url to folder redirects/pointers

```json
{
	"rootPaths": [
		"./build/test",
		"./node_modules/omneo-globals/dist/static"
	],
	"mappings": {
		"/bower_components": "./bower_components",
		"/node_modules": "./node_modules",
		"/node_modules/omneo-elements/dist": "./build/inline",
		"/build": "./build",
		"/test": "./build/test"
	}
}
```

## Usage

See the tools help output for all commands and options

```sh
yarn run opt --help
```

## Using the Server Directly

You can also start the server directly if you would like to use it as a lightweight testing environement.
It is useful to add this to your `npm-scripts`.

```sh
node ./node_modules/open-polymer-tester/server.js start --port 3333
```
```json
{
	"scripts": {
		"server": "node ./node_modules/open-polymer-tester/server.js start --port 3333"
	}
}
```

## Linux Issues

Chrome on linux spams `/tmp` with stuff, so it's recommended to nuke the directory before doing a run.
Eventually this build up will cause random failures because chrome closed itself from some internal error.

```sh
rm -rf /tmp
mkdir /tmp
```

Chrome on linux is a fickle beast and does not behave the same way as it does on windows, especially when
it comes to timers and microtasks. If you encounter issues of tests failing on linux that don't on windows,
then you need to reduce your concurrency limit, probably all the way down to 1. Easiest way to do this is
with the environment flag, but you can use the cli flag too.

```sh
# environment variable
export OPT_CONCURRENT=1

# cli flag
$ opt run --concurrent 1
```

If it yells at you about being or running as root, you need to use the `no-sandbox` setting.

```sh
# environment variable
export OPT_NO_SANDBOX='true'

$ opt run --no-sandbox
```
