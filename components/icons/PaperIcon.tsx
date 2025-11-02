
// Fix: Populating icon component with SVG content.
import React from 'react';

export const PaperIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12.75h7.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 18v-12c0-.621.504-1.125 1.125-1.125h14.25c.621 0 1.125.504 1.125 1.125v12c0 .621-.504 1.125-1.125 1.125H4.875A1.125 1.125 0 0 1 3.75 18Z" />
  </svg>
);