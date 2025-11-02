
import React from 'react';

export const UserAvatarIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <rect width="32" height="32" rx="16" fill="#4A5568"/>
    <path d="M21.5 24.5C21.5 21.4624 19.0376 19 16 19C12.9624 19 10.5 21.4624 10.5 24.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="16" cy="14" r="3" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
