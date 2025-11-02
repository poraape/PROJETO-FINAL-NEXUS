import React from 'react';

export const BugIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 1 0-2.636 6.364M16.5 12V8.25" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 16.5.75 2.25" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m13.5 16.5-.75 2.25" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m12 8.25-1.5.75" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m12 8.25 1.5.75" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6" />
  </svg>
);
