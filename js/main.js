$(function() {

	'use strict';

	// Form

	var contactForm = function() {

		if ($('#contactForm').length > 0 ) {
			$( "#contactForm" ).validate( {
				rules: {
					name: "required",
					// phoneNumber: "required",
					email: {
						required: true,
						email: true
					},
					body: {
						required: true,
						minlength: 5
					}
				},
				messages: {
					name: "Please enter your name",
					// phoneNumber: "Please enter your phone number",
					email: "Please enter a valid email address",
					body: "Please enter a message"
				},
				/* submit via ajax */
				submitHandler: function(form) {		
					var $submit = $('.submitting'),
						waitText = 'Submitting...';

					$.ajax({   	
				      type: "POST",
				      url: "https://wear-glasgow.azurewebsites.net/api/EnquiryEmail?code=Cyp5Ej2uzYUSFigGqOFh426KruURlzpKq3LF4a3tJBTMAzFuDOeCjQ==",
				      data: JSON.stringify(Object.fromEntries(new FormData(form))),

				      beforeSend: function() { 
				      	$submit.css('display', 'block').text(waitText);
				      },
				      success: function(msg) {
		               if (msg == 'OK') {
		               	$('#form-message-warning').hide();
				            setTimeout(function(){
		               		$('#contactForm').fadeOut();
		               	}, 1000);
				            setTimeout(function(){
				               $('#form-message-success').fadeIn();   
		               	}, 1400);
			               
			            } else {
			               $('#form-message-warning').html(msg);
				            $('#form-message-warning').fadeIn();
				            $submit.css('display', 'none');
			            }
				      },
				      error: function() {
				      	$('#form-message-warning').html("Something went wrong. Please try again.");
				         $('#form-message-warning').fadeIn();
				         $submit.css('display', 'none');
				      }
			      });    		
		  		}
				
			} );
		}
	};
	contactForm();

});