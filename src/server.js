const express = require( 'express' );
const fs = require( 'fs-extra' );
const path = require( 'path' );
const serveStatic = require( 'serve-static' );

const app = express();

// app.use( require( 'connect-history-api-fallback' )() );
app.use( require( 'helmet' )( { noCache: true, hsts: false } ) );
app.use( require( 'compression' )() );

function fullPath( part ) {
	return path.resolve( part );
}

function isObject( source ) {
	const nonNullObject = source && typeof source === 'object';
	const toString = Object.prototype.toString.call( source );

	return Boolean( nonNullObject && toString === '[object Object]' );
}

function setup( settings ) {
	if ( !isObject( settings ) ) {
		throw new Error( 'Settings must be an object' );
	}

	if ( Array.isArray( settings.rootPaths ) ) {
		settings.rootPaths.forEach( function addRootMapping( source ) {
			app.use( serveStatic( fullPath( source ) ) );
		} );
	}

	if ( isObject( settings.mappings ) ) {
		Object.keys( settings.mappings ).forEach( function addNormalMapping( pathSegment ) {
			const source = settings.mappings[ pathSegment ];

			app.use( pathSegment, serveStatic( fullPath( source ) ) );
		} );
	}
}

function start( port, callback ) {
	if ( typeof port !== 'number' || port < 3000 ) {
		throw new Error( 'Invalid port to bind server to' );
	}

	if ( typeof callback !== 'function' ) {
		callback = Function.prototype;
	}

	app.server = app.listen( port, callback );
}

function stop( callback ) {
	if ( typeof callback !== 'function' ) {
		callback = Function.prototype;
	}

	if ( app.server ) {
		app.server.close( callback );
	} else {
		callback();
	}
}

const yargs = require( 'yargs' )
	.option( 'server-mappings', {
		describe: 'JSON file for mapping folders to URLs',
		alias: 'm',
		default: 'serverMappings.json',
		string: true,
	} )
	.option( 'port', {
		alias: 'p',
		describe: 'Port to run the server on',
		number: true,
	} )
	.command( 'start', 'Start the server', {}, function startCommand( args ) {
		if ( args.port ) {
			const filePath = path.resolve( '.', args.serverMappings );
			const mappings = fs.readJsonSync( filePath );

			setup( mappings );

			start( args.port, function callback() {
				console.log( `Server running on port ${args.port}...` );
			} );
		}
	} )
	.argv;

module.exports = {
	app,
	setup,
	start,
	stop,
};

( function iife() {
	return yargs;
}() );
