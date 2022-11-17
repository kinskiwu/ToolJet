import React from 'react';
import { ButtonSolid } from '../_components/AppButton';
export const ForgotPasswordInfoScreen = function ForgotPasswordInfoScreen({ props, email }) {
  const darkMode = localStorage.getItem('darkMode') === 'true';

  return (
    <div className="info-screen-wrapper">
      <div className="forget-password-info-card">
        <img
          className="info-screen-email-img"
          src={
            darkMode
              ? 'assets/images/onboardingassets/Illustrations/Reset password mail_dark.svg'
              : 'assets/images/onboardingassets/Illustrations/Reset password mail.svg'
          }
          alt="email image"
        />
        <h1 className="common-auth-section-header">Check your mail</h1>
        <p className="info-screen-description">
          We’ve sent an email to {email} with a password reset link. Please click on that link to reset your password.
        </p>
        <p className="info-screen-spam-msg">Did not receive an email? Check your spam folder.</p>
        <div className="separator-onboarding">
          <div className="separator">
            <h2>
              <span>OR</span>
            </h2>
          </div>
        </div>
        <ButtonSolid
          variant="secondary"
          className="forgot-password-info-btn"
          onClick={() => props.history.push('/login')}
        >
          Back to log in
        </ButtonSolid>
      </div>
    </div>
  );
};