/* eslint no-unused-expressions: 0 */

suite( 'Unit Test Utilities', function unitTestHelpersSuite() {

	test( 'flush(..)', function test( done ) {
		window.flush( done );
	} );

	test( 'animationFrameFlush(..)', function test( done ) {
		window.animationFrameFlush( done );
	} );

	suite( 'waitFor', function waitForSuite() {
		test( 'Bare Minimum', function test( done ) {
			const conditional = window.sinon.stub().throws();

			function callback() {
				done();
			}

			window.waitFor( conditional, callback );
		} );

		test( 'Interval', function test( done ) {
			const conditional = window.sinon.stub()
				.onFirstCall()
				.throws()
				.onSecondCall()
				.throws()
				.onThirdCall()
				.returns( true );

			function callback( err ) {
				expect( err ).to.be.null;
				expect( conditional.callCount ).to.equal( 3 );

				done();
			}

			window.waitFor( conditional, callback, 10, 100 );
		} );

		test( 'Specific Time', function test( done ) {
			const conditional = window.sinon.stub().throws();
			const targetTime = Date.now() + 100;

			function callback( err ) {
				expect( err ).to.be.instanceof( Error );
				expect( conditional.callCount ).to.at.least( 2 );
				expect( Date.now() ).to.be.above( targetTime ).but.below( targetTime + 1000 );

				done();
			}

			window.waitFor( conditional, callback, 10, 1000, targetTime );
		} );

		test( 'Conditional Never Passes', function test( done ) {
			const conditional = window.sinon.stub().throws();

			function callback( err ) {
				expect( err ).to.be.instanceof( Error );
				expect( conditional.callCount ).to.at.least( 2 );

				done();
			}

			window.waitFor( conditional, callback, 10, 100 );
		} );
	} );

} );
