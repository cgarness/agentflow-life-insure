import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import UnderwritingPage from '../UnderwritingPage';
import { basicsSchema } from '../chat/basics';

function fillBasics() {
  fireEvent.change(screen.getByLabelText('Age'), { target: { value: '65' } });
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'TX' } });
  fireEvent.change(screen.getByLabelText('Height'), { target: { value: '66' } });
  fireEvent.change(screen.getByLabelText('Weight (lb)'), { target: { value: '170' } });
  fireEvent.change(screen.getByLabelText('Smoking / nicotine'), { target: { value: 'nonsmoker' } });
}
function send(text: string) {
  fireEvent.change(screen.getByLabelText('Health and medication notes'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send health note' }));
}
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); });
describe('standalone AgentFlow dark chat', () => {
  it('starts empty, with brand logo, five basics and one chat box', () => {
    render(<UnderwritingPage />);
    expect(screen.getByAltText('AgentFlow')).toHaveAttribute('src', '/agentflow-logo-full-on-dark.png');
    expect(screen.getByLabelText('Age')).toHaveValue('');
    expect(screen.getByLabelText('Health and medication notes')).toHaveValue('');
    expect(screen.queryByRole('region', { name: 'Carrier results' })).not.toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(document.title).toBe('Quick Underwriting | AgentFlow');
    expect(screen.queryByText('Commission reference')).not.toBeInTheDocument();
  });
  it('real Zod rejects invalid basics and extra identifiers', () => {
    expect(basicsSchema.safeParse({ age: 'no' }).success).toBe(false);
    render(<UnderwritingPage />); send('COPD');
    expect(screen.getByText('Complete the client basics first.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Carrier results' })).not.toBeInTheDocument();
  });
  it('uses the real parser and evaluator with no mocked carrier responses', () => {
    render(<UnderwritingPage />); fillBasics(); send('type 2 diabetes copd had cancer 7 years ago');
    expect(screen.getByRole('region', { name: 'Carrier results' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText('What type of cancer?')).toBeInTheDocument();
    expect(screen.queryByText('No name needed')).not.toBeInTheDocument();
    expect(screen.queryByText('Highest commission')).not.toBeInTheDocument();
  });
  it('requires confirmation before using a medication correction', () => {
    render(<UnderwritingPage />); fillBasics(); send('takes metfornin');
    expect(screen.getByText('“metfornin” — did you mean:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Metformin' }));
    expect(screen.queryByText('“metfornin” — did you mean:')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Metformin' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Diabetes' })).not.toBeInTheDocument();
  });
  it('resets all captured notes, basics and medication suggestions', () => {
    render(<UnderwritingPage />); fillBasics(); send('takes metfornin');
    fireEvent.click(screen.getByRole('button', { name: 'New case' }));
    expect(screen.getByLabelText('Age')).toHaveValue('');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('“metfornin” — did you mean:')).not.toBeInTheDocument();
  });
  it('clears synchronously on pagehide and starts blank on pageshow', () => {
    render(<UnderwritingPage />); fillBasics(); send('COPD');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('pageshow')); });
    expect(screen.getByLabelText('Age')).toHaveValue('');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('restores the pre-existing document theme and title', () => {
    document.title = 'Original';
    const { unmount } = render(<UnderwritingPage />);
    unmount(); expect(document.title).toBe('Original'); expect(document.documentElement).not.toHaveClass('dark');
  });
  it('does not remove a dark theme that existed before mounting', () => {
    document.documentElement.classList.add('dark');
    const { unmount } = render(<UnderwritingPage />); unmount(); expect(document.documentElement).toHaveClass('dark');
  });
  it('keeps unknown text literal and never adds an injected image', () => {
    render(<UnderwritingPage />); fillBasics(); send('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
  it('rejects obvious identifiers without saving the message', () => {
    render(<UnderwritingPage />); fillBasics(); send('test@example.invalid has COPD');
    expect(screen.getByText('Remove the client’s email, phone or identifying numbers. Health details only.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('Shift+Enter does not submit but Enter does', () => {
    render(<UnderwritingPage />); fillBasics();
    const textarea = screen.getByLabelText('Health and medication notes');
    fireEvent.change(textarea, { target: { value: 'COPD' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true }); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'Enter' }); expect(screen.getAllByRole('article')).toHaveLength(3);
  });
  it('composing text does not accidentally submit', () => {
    render(<UnderwritingPage />); fillBasics();
    const textarea = screen.getByLabelText('Health and medication notes');
    fireEvent.change(textarea, { target: { value: 'COPD' } });
    fireEvent.compositionStart(textarea); fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.compositionEnd(textarea); fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});
