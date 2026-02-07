import { describe, it, expect } from 'vitest';
import { symbolKindToString, filterSymbolsByType, formatSymbols, DocumentSymbol } from '../src/lsp-client.js';

describe('Symbol Utilities', () => {
  describe('symbolKindToString', () => {
    it('should convert known symbol kinds to strings', () => {
      expect(symbolKindToString(5)).toBe('Class');
      expect(symbolKindToString(6)).toBe('Method');
      expect(symbolKindToString(7)).toBe('Property');
      expect(symbolKindToString(8)).toBe('Field');
      expect(symbolKindToString(9)).toBe('Constructor');
      expect(symbolKindToString(10)).toBe('Enum');
      expect(symbolKindToString(11)).toBe('Interface');
      expect(symbolKindToString(24)).toBe('Event');
    });

    it('should handle unknown symbol kinds', () => {
      expect(symbolKindToString(999)).toBe('Unknown');
      expect(symbolKindToString(0)).toBe('Unknown');
      expect(symbolKindToString(-1)).toBe('Unknown');
    });
  });

  describe('filterSymbolsByType', () => {
    const mockSymbols: DocumentSymbol[] = [
      {
        name: 'MyProperty',
        kind: 7, // Property
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      },
      {
        name: 'MyMethod',
        kind: 6, // Method
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
        selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
      },
      {
        name: 'MyField',
        kind: 8, // Field
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 10 } },
        selectionRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 10 } },
      },
      {
        name: 'MyEvent',
        kind: 24, // Event
        range: { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } },
        selectionRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } },
      },
      {
        name: 'MyConstructor',
        kind: 9, // Constructor
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: 10 } },
        selectionRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 10 } },
      },
      {
        name: 'MyClass',
        kind: 5, // Class
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
        selectionRange: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
      },
    ];

    it('should filter properties', () => {
      const result = filterSymbolsByType(mockSymbols, 'Property');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('MyProperty');
    });

    it('should filter methods (including constructors)', () => {
      const result = filterSymbolsByType(mockSymbols, 'Method');
      expect(result).toHaveLength(2);
      expect(result.map(s => s.name).sort()).toEqual(['MyConstructor', 'MyMethod']);
    });

    it('should filter fields', () => {
      const result = filterSymbolsByType(mockSymbols, 'Field');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('MyField');
    });

    it('should filter events', () => {
      const result = filterSymbolsByType(mockSymbols, 'Event');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('MyEvent');
    });

    it('should filter classes', () => {
      const result = filterSymbolsByType(mockSymbols, 'Class');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('MyClass');
    });

    it('should return empty array for non-matching types', () => {
      const result = filterSymbolsByType(mockSymbols, 'Interface');
      expect(result).toHaveLength(0);
    });
  });

  describe('formatSymbols', () => {
    const mockSymbols: DocumentSymbol[] = [
      {
        name: 'MyMethod',
        detail: 'public void MyMethod()',
        kind: 6,
        range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
        selectionRange: { start: { line: 1, character: 5 }, end: { line: 1, character: 13 } },
      },
      {
        name: 'MyProperty',
        detail: 'public string MyProperty { get; set; }',
        kind: 7,
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 30 } },
        selectionRange: { start: { line: 5, character: 14 }, end: { line: 5, character: 24 } },
      },
    ];

    it('should format symbols with full details', () => {
      const result = formatSymbols(mockSymbols, false);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('name', 'MyMethod');
      expect(result[0]).toHaveProperty('kind', 'Method');
      expect(result[0]).toHaveProperty('detail', 'public void MyMethod()');
      expect(result[0]).toHaveProperty('range');
      
      expect(result[1]).toHaveProperty('name', 'MyProperty');
      expect(result[1]).toHaveProperty('kind', 'Property');
      expect(result[1]).toHaveProperty('detail', 'public string MyProperty { get; set; }');
      expect(result[1]).toHaveProperty('range');
    });

    it('should format symbols with signatures only', () => {
      const result = formatSymbols(mockSymbols, true);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('name', 'MyMethod');
      expect(result[0]).toHaveProperty('kind', 'Method');
      expect(result[0]).toHaveProperty('signature', 'public void MyMethod()');
      expect(result[0]).not.toHaveProperty('range');
      
      expect(result[1]).toHaveProperty('name', 'MyProperty');
      expect(result[1]).toHaveProperty('kind', 'Property');
      expect(result[1]).toHaveProperty('signature', 'public string MyProperty { get; set; }');
      expect(result[1]).not.toHaveProperty('range');
    });

    it('should handle symbols without detail', () => {
      const symbolsWithoutDetail: DocumentSymbol[] = [
        {
          name: 'SimpleSymbol',
          kind: 6,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
      ];

      const resultFull = formatSymbols(symbolsWithoutDetail, false);
      expect(resultFull[0]).toHaveProperty('name', 'SimpleSymbol');
      expect(resultFull[0]).toHaveProperty('kind', 'Method');
      expect(resultFull[0].detail).toBeUndefined();

      const resultSigOnly = formatSymbols(symbolsWithoutDetail, true);
      expect(resultSigOnly[0]).toHaveProperty('name', 'SimpleSymbol');
      expect(resultSigOnly[0]).toHaveProperty('kind', 'Method');
      expect(resultSigOnly[0]).not.toHaveProperty('signature');
    });
  });
});
