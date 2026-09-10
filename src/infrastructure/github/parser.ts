/**
 * Excel File Parser - Wraps existing SheetJS parser
 * Implements IFileParser port
 */
import type { IFileParser } from '@core/domain/repositories/ports';

export class ExcelFileParser implements IFileParser {
  private xlsxPromise: Promise<any> | null = null;

  async parseExcel(file: ArrayBuffer | File): Promise<{ SheetNames: string[]; Sheets: Record<string, any> }> {
    const XLSX = await this.loadXLSX();
    
    const buffer = file instanceof File ? await file.arrayBuffer() : file;
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    
    return {
      SheetNames: workbook.SheetNames,
      Sheets: workbook.Sheets
    };
  }

  private async loadXLSX(): Promise<any> {
    if (this.xlsxPromise) return this.xlsxPromise;

    this.xlsxPromise = new Promise((resolve, reject) => {
      if ((window as any).XLSX) return resolve((window as any).XLSX);
      
      const script = document.createElement('script');
      script.src = 'xlsx.full.min.js';
      script.async = true;
      script.onload = () => (window as any).XLSX ? resolve((window as any).XLSX) : reject(new Error('XLSX not loaded'));
      script.onerror = () => reject(new Error('Failed to load xlsx.full.min.js'));
      document.head.appendChild(script);
    });

    return this.xlsxPromise;
  }
}