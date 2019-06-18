/* eslint-disable func-names, no-unused-vars, prefer-rest-params, no-shadow, no-underscore-dangle, no-cond-assign, no-prototype-builtins, no-plusplus, id-match, no-use-before-define */

/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

window.mochaInterface = ( function mochaInterface( exports ) {

	const interfaceExtensions = [];

	/**
	 * Registers an extension that extends the global `Mocha` implementation
	 * with new helper methods. These helper methods will be added to the `window`
	 * when tests run for both BDD and TDD interfaces.
	 */
	function extendInterfaces( helperName, helperFactory ) {
		interfaceExtensions.push( function () {
			const Mocha = window.Mocha;

			// For all Mocha interfaces (probably just TDD and BDD):

			Object.keys( Mocha.interfaces ).forEach( function ( interfaceName ) {
				// This is the original callback that defines the interface (TDD or BDD):
				const originalInterface = Mocha.interfaces[ interfaceName ];

				// This is the name of the "teardown" or "afterEach" property for the
				// current interface:
				const teardownProperty = interfaceName === 'tdd' ? 'teardown' : 'afterEach';

				// The original callback is monkey patched with a new one that appends to
				// the global context however we want it to:

				Mocha.interfaces[ interfaceName ] = function ( suite ) {
					// Call back to the original callback so that we get the base interface:
					originalInterface.apply( this, arguments );

					// Register a listener so that we can further extend the base interface:
					suite.on( 'pre-require', function ( context, file, mocha ) {
						// Capture a bound reference to the teardown function as a convenience:
						const teardown = context[ teardownProperty ].bind( context );

						// Add our new helper to the testing context. The helper is generated
						// by a factory method that receives the context, the teardown function
						// and the interface name and returns the new method to be added to
						// that context:

						context[ helperName ] = helperFactory( context, teardown, interfaceName );
					} );
				};
			} );
		} );
	}

	/**
	 * Applies any registered interface extensions. The extensions will be applied
	 * as many times as this function is called, so don't call it more than once.
	 */
	function applyExtensions() {
		interfaceExtensions.forEach( function ( applyExtension ) {
			applyExtension();
		} );
	}

	extendInterfaces( 'fixture', function ( context, teardown ) {

		// Return context.fixture if it is already a thing, for backwards
		// compatibility with `test-fixture-mocha.js`:
		return context.fixture || function fixture( fixtureId, model ) {

			// Automatically register a teardown callback that will restore the
			// test-fixture:
			teardown( function () {
				document.getElementById( fixtureId ).restore();
			} );

			// Find the test-fixture with the provided ID and create it, returning
			// the results:
			return document.getElementById( fixtureId ).create( model );
		};
	} );

	/**
	 * stub
	 *
	 * The stub addon allows the tester to partially replace the implementation of
	 * an element with some custom implementation. Usage example:
	 *
	 * beforeEach(function() {
	 *   stub('x-foo', {
	 *     attached: function() {
	 *       // Custom implementation of the `attached` method of element `x-foo`..
	 *     },
	 *     otherMethod: function() {
	 *       // More custom implementation..
	 *     },
	 *     getterSetterProperty: {
	 *       get: function() {
	 *         // Custom getter implementation..
	 *       },
	 *       set: function() {
	 *         // Custom setter implementation..
	 *       }
	 *     },
	 *     // etc..
	 *   });
	 * });
	 */
	extendInterfaces( 'stub', function ( context, teardown ) {

		return function stub( tagName, implementation ) {
			// Find the prototype of the element being stubbed:
			const proto = document.createElement( tagName ).constructor.prototype;

			// For all keys in the implementation to stub with..
			const stubs = Object.keys( implementation ).map( function ( key ) {
				// Stub the method on the element prototype with Sinon:
				return window.sinon.stub( proto, key ).callsFake( implementation[ key ] );
			} );

			// After all tests..
			teardown( function () {
				stubs.forEach( function ( stub ) {
					stub.restore();
				} );
			} );
		};
	} );

	// replacement map stores what should be
	let replacements = {};
	let replaceTeardownAttached = false;

	/**
	 * replace
	 *
	 * The replace addon allows the tester to replace all usages of one element with
	 * another element within all Polymer elements created within the time span of
	 * the test. Usage example:
	 *
	 * beforeEach(function() {
	 *   replace('x-foo').with('x-fake-foo');
	 * });
	 *
	 * All annotations and attributes will be set on the placement element the way
	 * they were set for the original element.
	 */
	extendInterfaces( 'replace', function ( context, teardown ) {
		return function replace( oldTagName ) {
			return {
				with( tagName ) {
					// Standardizes our replacements map
					oldTagName = oldTagName.toLowerCase();
					tagName = tagName.toLowerCase();

					replacements[ oldTagName ] = tagName;

					// If the function is already a stub, restore it to original
					if ( document.importNode.isSinonProxy ) {
						return;
					}

					if ( !Polymer.Element ) {
						Polymer.Element = function () { };
						Polymer.Element.prototype._stampTemplate = function () { };
					}

					// Keep a reference to the original `document.importNode`
					// implementation for later:
					const originalImportNode = document.importNode;

					// Use Sinon to stub `document.ImportNode`:
					window.sinon.stub( document, 'importNode' )
						.callsFake( function ( origContent, deep ) {
							const templateClone = document.createElement( 'template' );
							const content = templateClone.content;
							const inertDoc = content.ownerDocument;

							// imports node from inertDoc which holds inert nodes.
							templateClone.content.appendChild( inertDoc.importNode( origContent, true ) );

							// optional arguments are not optional on IE.
							const nodeIterator = document.createNodeIterator(
								content,
								NodeFilter.SHOW_ELEMENT, null, true
							);
							let node;

							// Traverses the tree. A recently-replaced node will be put next, so
							// if a node is replaced, it will be checked if it needs to be
							// replaced again.
							while ( node = nodeIterator.nextNode() ) {
								let currentTagName = node.tagName.toLowerCase();

								if ( replacements.hasOwnProperty( currentTagName ) ) {
									currentTagName = replacements[ currentTagName ];

									// find the final tag name.
									while ( replacements[ currentTagName ] ) {
										currentTagName = replacements[ currentTagName ];
									}

									// Create a replacement:
									const replacement = document.createElement( currentTagName );

									// For all attributes in the original node..
									for ( let index = 0; index < node.attributes.length; ++index ) {
									// Set that attribute on the replacement:
										replacement.setAttribute( node.attributes[ index ].name, node.attributes[ index ].value );
									}

									// Replace the original node with the replacement node:
									node.parentNode.replaceChild( replacement, node );
								}
							}

							return originalImportNode.call( this, content, deep );
						} );

					if ( !replaceTeardownAttached ) {
						// After each test...
						teardown( function () {
							replaceTeardownAttached = true;

							// Restore the stubbed version of `document.importNode`:
							if ( document.importNode.isSinonProxy ) {
								document.importNode.restore();
							}

							// Empty the replacement map
							replacements = {};
						} );
					}
				},
			};
		};
	} );

	// Mocha global helpers, broken out by testing method.
	//
	// Keys are the method for a particular interface; values are their analog in
	// the opposite interface.
	const MOCHA_EXPORTS = {
		// https://github.com/visionmedia/mocha/blob/master/lib/interfaces/tdd.js
		tdd: {
			setup: '"before"',
			teardown: '"after"',
			suiteSetup: '"beforeEach"',
			suiteTeardown: '"afterEach"',
			suite: '"describe" or "context"',
			test: '"it" or "specify"',
		},

		// https://github.com/visionmedia/mocha/blob/master/lib/interfaces/bdd.js
		bdd: {
			before: '"setup"',
			after: '"teardown"',
			beforeEach: '"suiteSetup"',
			afterEach: '"suiteTeardown"',
			describe: '"suite"',
			context: '"suite"',
			xdescribe: '"suite.skip"',
			xcontext: '"suite.skip"',
			it: '"test"',
			xit: '"test.skip"',
			specify: '"test"',
			xspecify: '"test.skip"',
		},
	};

	/**
	 * Exposes all Mocha methods up front, configuring and running mocha
	 * automatically when you call them.
	 *
	 * The assumption is that it is a one-off (sub-)suite of tests being run.
	 */
	function stubInterfaces() {
		Object.keys( MOCHA_EXPORTS ).forEach( function ( ui ) {
			Object.keys( MOCHA_EXPORTS[ ui ] ).forEach( function ( key ) {
				window[ key ] = function wrappedMochaFunction() {
					_setupMocha( ui, key, MOCHA_EXPORTS[ ui ][ key ] );
					if ( !window[ key ] || window[ key ] === wrappedMochaFunction ) {
						throw new Error( `Expected mocha.setup to define ${key}` );
					}
					window[ key ]( ...arguments );
				};
			} );
		} );
	}

	// Whether we've called `mocha.setup`
	const _mochaIsSetup = false;

	/**
	 * @param {string} ui Sets up mocha to run `ui`-style tests.
	 * @param {string} key The method called that triggered this.
	 * @param {string} alternate The matching method in the opposite interface.
	 */
	function _setupMocha( ui, key, alternate ) {
		const mochaOptions = window.mochaOptions || {};

		if ( !mochaOptions.timeout ) mochaOptions.timeout = 10 * 1000;

		if ( mochaOptions.ui && mochaOptions.ui !== ui ) {
			const message = `Mixing ${mochaOptions.ui} and ${ui} Mocha styles is not supported. You called "${key}". Did you mean ${alternate}?`;

			throw new Error( message );
		}
		if ( _mochaIsSetup ) return;

		applyExtensions();
		mochaOptions.ui = ui;
		mocha.setup( mochaOptions ); // Note that the reporter is configured in run.js.
	}

	exports.stubInterfaces = stubInterfaces;

	return exports;

}( {} ) );
