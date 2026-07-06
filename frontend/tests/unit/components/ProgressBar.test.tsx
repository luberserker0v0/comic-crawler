import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ProgressBar } from '../../../src/components/ProgressBar';

describe('ProgressBar', () => {
  it('should render progress bar with correct percentage', () => {
    render(<ProgressBar current={5} total={10} label="Test" />);

    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('5 / 10')).toBeInTheDocument();
  });

  it('should render 0% when total is 0', () => {
    render(<ProgressBar current={0} total={0} />);

    const progressBar = document.querySelector('.bg-blue-600');
    expect(progressBar).toHaveStyle({ width: '0%' });
  });

  it('should render 100% when current equals total', () => {
    render(<ProgressBar current={10} total={10} />);

    const progressBar = document.querySelector('.bg-blue-600');
    expect(progressBar).toHaveStyle({ width: '100%' });
  });

  it('should apply custom className', () => {
    render(<ProgressBar current={5} total={10} className="custom-class" />);

    const container = document.querySelector('.custom-class');
    expect(container).toBeInTheDocument();
  });
});
