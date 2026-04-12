import { sanitizeInput } from '../../utils/sanitize';

describe('sanitizeInput', () => {
  it('should return input unchanged when it contains no HTML or special characters', () => {
    expect(sanitizeInput('hello world')).toBe('hello world');
  });

  it('should return alphanumeric with dashes and underscores unchanged', () => {
    expect(sanitizeInput('room_1-abc123')).toBe('room_1-abc123');
  });

  it('should strip a complete script tag but preserve inner text', () => {
    expect(sanitizeInput('<script>alert(1)</script>')).toBe('alert(1)');
  });

  it('should strip a bold tag and preserve inner text', () => {
    expect(sanitizeInput('<b>bold</b>')).toBe('bold');
  });

  it('should treat < text > as a tag and strip the whole sequence', () => {
    // /<[^>]*>/g treats "< b >" as a tag and removes it, leaving "a  c"
    expect(sanitizeInput('a < b > c')).toBe('a  c');
  });

  it('should remove single quotes', () => {
    expect(sanitizeInput("it's here")).toBe('its here');
  });

  it('should remove double quotes', () => {
    expect(sanitizeInput('"quoted"')).toBe('quoted');
  });

  it('should trim leading and trailing whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('should handle an empty string without throwing', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('should strip an img XSS payload entirely (no inner text)', () => {
    expect(sanitizeInput('<img onerror=alert(1)>')).toBe('');
  });

  it('should strip nested HTML tags and preserve text content', () => {
    expect(sanitizeInput('<div><span>text</span></div>')).toBe('text');
  });

  it('should strip anchor tag with javascript href', () => {
    // The tag is removed; the inner text remains
    const result = sanitizeInput('<a href="javascript:void(0)">click</a>');
    expect(result).toContain('click');
    expect(result).not.toContain('<a');
    expect(result).not.toContain('>click<');
  });
});
