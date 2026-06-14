import { getPdfTemplateSettings } from './app.js';
// Utility to format number into Indian Currency Style (e.g. 30,14,993.00)
export function formatIndianCurrency(num) {
  if (isNaN(num) || num === null) return '0.00';
  const val = parseFloat(num).toFixed(2);
  const parts = val.split('.');
  let lastThree = parts[0].substring(parts[0].length - 3);
  const otherParts = parts[0].substring(0, parts[0].length - 3);
  if (otherParts !== '') {
    lastThree = ',' + lastThree;
  }
  const formatted = otherParts.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree + '.' + parts[1];
  return formatted;
}

// Convert amount to words in Indian Numbering System
export function numberToIndianWords(amount) {
  const words = {
    0: '', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
    10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen',
    17: 'seventeen', 18: 'eighteen', 19: 'nineteen', 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty',
    60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety'
  };

  const num = Math.round(parseFloat(amount));
  if (num === 0) return 'Rupees zero only';

  function convertLessThanThousand(n) {
    let str = '';
    if (n >= 100) {
      str += words[Math.floor(n / 100)] + ' hundred ';
      n %= 100;
    }
    if (n > 0) {
      if (str !== '') str += 'and ';
      if (n < 20) {
        str += words[n];
      } else {
        str += words[Math.floor(n / 10) * 10] + (n % 10 > 0 ? '-' + words[n % 10] : '');
      }
    }
    return str.trim();
  }

  let tempNum = num;
  let wordResult = '';

  const crore = Math.floor(tempNum / 10000000);
  tempNum %= 10000000;
  if (crore > 0) {
    wordResult += convertLessThanThousand(crore) + ' crore ';
  }

  const lakh = Math.floor(tempNum / 100000);
  tempNum %= 100000;
  if (lakh > 0) {
    wordResult += convertLessThanThousand(lakh) + ' lakh ';
  }

  const thousand = Math.floor(tempNum / 1000);
  tempNum %= 1000;
  if (thousand > 0) {
    wordResult += convertLessThanThousand(thousand) + ' thousand ';
  }

  if (tempNum > 0) {
    wordResult += convertLessThanThousand(tempNum);
  }

  return `Rupees ${wordResult.trim()} only`;
}

function renderItem(item) {
  if (item.type === 'quantity-rate') {
    return renderQuantityRateItem(item);
  } else if (item.type === 'plinth-area') {
    return renderPlinthAreaItem(item);
  } else if (item.type === 'lump-sum') {
    return renderLumpSumItem(item);
  }
  return '';
}

function renderQuantityRateItem(item) {
  let itemNoText = item.itemNo;
  if (!/item/i.test(itemNoText)) {
    itemNoText = 'Item No. ' + itemNoText;
  }

  const rawCost = item.quantity * item.rate;
  const hasDeduction = item.deductionPct > 0;

  // Build measurement rows
  let measurementRowsHtml = '';
  const measurements = item.measurements && item.measurements.length > 0 ? item.measurements : [];

  if (measurements.length > 0) {
    const mRowsHtml = measurements.map(m => {
      const nos = parseFloat(m.nos) || 0;
      const l   = parseFloat(m.l);
      const b   = parseFloat(m.b);
      const h   = parseFloat(m.h);
      const hasL = !isNaN(l) && m.l !== '';
      const hasB = !isNaN(b) && m.b !== '';
      const hasH = !isNaN(h) && m.h !== '';
      const hasDims = hasL || hasB || hasH;
      const subQty = parseFloat(m.subQty) || 0;

      let dimStr = '';
      if (hasDims) {
        const parts = [];
        if (hasL) parts.push(l.toFixed(3) + 'm');
        if (hasB) parts.push(b.toFixed(3) + 'm');
        if (hasH) parts.push(h.toFixed(3) + 'm');
        dimStr = parts.join(' × ');
      }

      return `
        <tr>
          <td style="padding: 1px 4px; text-align: left;">${m.description || ''}</td>
          <td style="padding: 1px 4px; text-align: center; width: 30px;">${nos}</td>
          <td style="padding: 1px 4px; text-align: left; color: #334155;">${dimStr}</td>
          <td style="padding: 1px 4px; text-align: right; font-weight: 600; width: 60px;">${subQty.toFixed(3)}</td>
        </tr>
      `;
    }).join('');

    measurementRowsHtml = `
      <div style="margin-left: 20mm; margin-bottom: 3px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 9.5pt; border-top: 1px solid #cbd5e1;">
          <thead>
            <tr style="color: #64748b; font-size: 8.5pt;">
              <th style="padding: 1px 4px; text-align: left; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Description</th>
              <th style="padding: 1px 4px; text-align: center; width: 30px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Nos</th>
              <th style="padding: 1px 4px; text-align: left; font-weight: 600; border-bottom: 1px solid #e2e8f0;">L × B × H</th>
              <th style="padding: 1px 4px; text-align: right; width: 60px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${mRowsHtml}
          </tbody>
          <tfoot>
            <tr style="font-weight: 700; border-top: 1px solid #cbd5e1;">
              <td colspan="3" style="padding: 2px 4px; text-align: right; font-size: 9pt;">Total</td>
              <td style="padding: 2px 4px; text-align: right;">${item.quantity.toFixed(3)} ${item.unit}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  } else {
    // Fallback: no measurements
    measurementRowsHtml = `
      <div class="pdf-row" style="margin-bottom: 1px;">
        <div style="margin-left: 20mm; width: 40mm; flex-shrink: 0;">Quantity</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1; display: flex; justify-content: flex-end; padding-right: 45mm;">
          <span style="width: 35mm; text-align: left;">x &nbsp;&nbsp;&nbsp;&nbsp; ${item.quantity.toFixed(2)} ${item.unit} =</span>
          <span style="width: 30mm; text-align: right;">${item.quantity.toFixed(2)} ${item.unit}</span>
        </div>
      </div>
    `;
  }

    let depInfoHtml = '';
    if (item.customDepreciation) {
      const totalPct = (item.customDepreciationPct || 0) * (item.customDepreciationAge || 0);
      depInfoHtml = `<span style="font-size: 8.5pt; color: #475569; font-weight: normal; margin-left: 5px;">(Depreciation: ${item.customDepreciationPct}%/yr for ${item.customDepreciationAge} yrs = ${totalPct}%)</span>`;
    }

    return `
    <div class="pdf-item-block" style="margin-bottom: 6mm; color: #000000; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; page-break-inside: avoid; break-inside: avoid;">
      <div class="pdf-row" style="font-weight: bold; margin-bottom: 2px;">
        <div style="flex-grow: 1;">${itemNoText} <span style="margin-left: 15mm;">${item.title}</span> ${depInfoHtml}</div>
      </div>
      ${item.description ? `<div style="margin-left: 20mm; font-style: italic; color: #334155; margin-bottom: 3px; font-size: 10pt;">${item.description}</div>` : ''}
      
      ${measurementRowsHtml}
      
      <!-- Rate Line -->
      <div class="pdf-row" style="margin-bottom: 1px;">
        <div style="margin-left: 20mm; flex-grow: 1;">
          @ &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(item.rate)}/${item.unit} &nbsp;&nbsp;&nbsp;&nbsp; (As per approved rate)
        </div>
        <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
          = &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(rawCost)}
        </div>
      </div>

      <!-- Deduction Line -->
      ${hasDeduction ? `
        <div class="pdf-row" style="margin-bottom: 1px;">
          <div style="margin-left: 20mm; flex-grow: 1;">
            Ded. ${item.deductionPct}% for ${item.deductionLabel || 'non conformity with CPWD norms'}
          </div>
          <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            = &nbsp;&nbsp;&nbsp;&nbsp; Rs. -${formatIndianCurrency(item.deductionAmount)}
          </div>
        </div>
        
        <!-- Net Total Line -->
        <div class="pdf-row">
          <div style="margin-left: 20mm; flex-grow: 1; font-weight: bold;">
            Net Amount
          </div>
          <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            = &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(item.totalCost)}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}


function renderPlinthAreaItem(item) {
  let itemNoText = item.itemNo;
  if (!/item/i.test(itemNoText)) {
    itemNoText = 'Item No. ' + itemNoText;
  }
  
  let titleText = item.title;
  if (!titleText.trim().startsWith(':')) {
    titleText = ': ' + titleText;
  }
  
  const rawCost = (item.unit === 'sqf' ? item.totalAreaSqft : item.totalAreaSqm) * item.rate;
  
  let depInfoHtml = '';
  if (item.customDepreciation) {
    const totalPct = (item.customDepreciationPct || 0) * (item.customDepreciationAge || 0);
    depInfoHtml = `<span style="font-size: 8.5pt; color: #475569; font-weight: normal; margin-left: 5px;">(Depreciation: ${item.customDepreciationPct}%/yr for ${item.customDepreciationAge} yrs = ${totalPct}%)</span>`;
  }

  return `
    <div class="pdf-item-block" style="margin-bottom: 6mm; color: #000000; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; page-break-inside: avoid; break-inside: avoid;">
      <div class="pdf-row" style="font-weight: bold; margin-bottom: 2px;">
        <div style="flex-grow: 1;">${itemNoText} <span style="margin-left: 15mm;">${titleText}</span> ${depInfoHtml}</div>
      </div>
      ${item.description ? `<div style="margin-left: 20mm; font-style: italic; color: #334155; margin-bottom: 3px; font-size: 10pt;">${item.description}</div>` : ''}
      
      <div style="margin-left: 20mm;">
        <div style="margin-bottom: 2px;">Plinth area of the building:-</div>
        
        <!-- Room Details -->
        ${item.rooms.map(r => `
          <div class="pdf-row" style="margin-bottom: 1px;">
            <div style="width: 25mm; flex-shrink: 0;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${r.name}</div>
            <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
            <div style="flex-grow: 1; display: flex; justify-content: flex-end; padding-right: 45mm;">
              <span style="width: 45mm; text-align: left;">${parseFloat(r.l).toFixed(2)} m x ${parseFloat(r.w).toFixed(2)} m =</span>
              <span style="width: 25mm; text-align: right;">${parseFloat(r.areaSqm).toFixed(2)} sqm</span>
            </div>
          </div>
        `).join('')}
        
        <!-- Total Plinth Area -->
        <div class="pdf-row" style="font-weight: 500; margin-bottom: 1px;">
          <div style="flex-grow: 1; text-align: right; padding-right: 45mm;">
            <span style="display: inline-block; width: 45mm; text-align: right; margin-right: 5px;">Total plinth area =</span>
            <span style="display: inline-block; width: 25mm; text-align: right;">${parseFloat(item.totalAreaSqm).toFixed(2)} sqm</span>
          </div>
        </div>
        
        <!-- Total Plinth Area in Sqft (only for sqf unit items) -->
        ${(item.unit === 'sqf' && parseFloat(item.totalAreaSqft) > 0) ? `
          <div class="pdf-row" style="font-weight: 500; margin-bottom: 2px;">
            <div style="flex-grow: 1; text-align: right; padding-right: 45mm;">
              <span style="display: inline-block; width: 55mm; text-align: right; margin-right: 5px;">Total plinth area in sq.foot =</span>
              <span style="display: inline-block; width: 25mm; text-align: right;">${parseFloat(item.totalAreaSqft).toFixed(2)} sqf</span>
            </div>
          </div>
        ` : ''}
        
        <!-- Rate Line -->
        <div class="pdf-row" style="margin-left: -5mm; margin-top: 1px;">
          <div style="flex-grow: 1;">
            @ &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(item.rate)}/${item.unit || 'sqm'} &nbsp;&nbsp;&nbsp;&nbsp; (As per approved rate)
          </div>
          <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            = &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(rawCost)}
          </div>
        </div>
        
        <!-- Deduction Line (if deduction exists) -->
        ${item.deductionPct > 0 ? `
          <div class="pdf-row" style="margin-left: -5mm; margin-top: 1px;">
            <div style="flex-grow: 1;">
              Ded. ${item.deductionPct}% for ${item.deductionLabel || 'non conformity with CPWD norms'}
            </div>
            <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0; color: #000000;">
              = &nbsp;&nbsp;&nbsp;&nbsp; Rs. -${formatIndianCurrency(item.deductionAmount)}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderLumpSumItem(item) {
  let itemNoText = item.itemNo;
  if (!/item/i.test(itemNoText)) {
    itemNoText = 'Item No. ' + itemNoText;
  }
  
  let titleText = item.title;
  if (item.excludeFromDepreciation && !titleText.trim().startsWith(':')) {
    titleText = ': ' + titleText;
  }
  
  const rawCost = item.rate;
  const hasDeduction = item.deductionPct > 0;

  return `
    <div class="pdf-item-block" style="margin-bottom: 6mm; color: #000000; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; page-break-inside: avoid; break-inside: avoid;">
      <div class="pdf-row" style="font-weight: bold; margin-bottom: 2px;">
        <div style="flex-grow: 1;">${itemNoText} <span style="margin-left: 15mm;">${titleText}</span></div>
      </div>
      ${item.description ? `<div style="margin-left: 20mm; font-style: italic; color: #334155; margin-bottom: 3px; font-size: 10pt;">${item.description}</div>` : ''}
      
      <div class="pdf-row" style="margin-bottom: 1px;">
        <div style="margin-left: 20mm; flex-grow: 1;">
          @ &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(item.rate)} &nbsp;&nbsp;&nbsp;&nbsp; --------L/S
        </div>
        <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
          = &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(rawCost)}
        </div>
      </div>

      <!-- Deduction Line -->
      ${hasDeduction ? `
        <div class="pdf-row" style="margin-bottom: 1px;">
          <div style="margin-left: 20mm; flex-grow: 1;">
            Ded. ${item.deductionPct}% for ${item.deductionLabel || 'non conformity with CPWD norms'}
          </div>
          <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            = &nbsp;&nbsp;&nbsp;&nbsp; Rs. -${formatIndianCurrency(item.deductionAmount)}
          </div>
        </div>
        
        <!-- Net Total Line -->
        <div class="pdf-row">
          <div style="margin-left: 20mm; flex-grow: 1; font-weight: bold;">
            Net Amount
          </div>
          <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            = &nbsp;&nbsp;&nbsp;&nbsp; Rs. ${formatIndianCurrency(item.totalCost)}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

export function exportToPDF(report, sketcherImage, isPrint = false) {
  const tpl = getPdfTemplateSettings();

  const includedItems = report.items.filter(item => item.includeInValuation);
  const depreciatedItems = includedItems.filter(item => !item.excludeFromDepreciation);
  const excludedItems = includedItems.filter(item => item.excludeFromDepreciation);

  let depreciatedItemsHtml = '';
  depreciatedItems.forEach(item => {
    depreciatedItemsHtml += renderItem(item);
  });

  let excludedItemsHtml = '';
  excludedItems.forEach(item => {
    excludedItemsHtml += renderItem(item);
  });

  let subtotalsHtml = `
    <div class="pdf-calc-block" style="margin-top: 5mm; margin-bottom: 5mm; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #000000;">
      <!-- Line above TOTAL (A) -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 2px;">
        <div style="width: 105mm; border-top: 1px solid #000;"></div>
      </div>
      
      <div class="pdf-row" style="font-weight: bold; margin-bottom: 2px;">
        <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">TOTAL (A) =</div>
        <div style="width: 45mm; text-align: right;">Rs. ${formatIndianCurrency(report.totalA)}</div>
      </div>
      
      <div class="pdf-row" style="margin-bottom: 2px;">
        <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">Deduct. ${tpl.contractorPct}% for Contractors Profit =</div>
        <div style="width: 45mm; text-align: right;">Rs. -${formatIndianCurrency(report.contractorDeduction)}</div>
      </div>
      
      <!-- Line above TOTAL (B) -->
      <div style="display: flex; justify-content: flex-end; margin-top: 2px; margin-bottom: 2px;">
        <div style="width: 105mm; border-top: 1px solid #000;"></div>
      </div>
      
      <div class="pdf-row" style="font-weight: bold; margin-bottom: 2px;">
        <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">TOTAL (B) =</div>
        <div style="width: 45mm; text-align: right;">Rs. ${formatIndianCurrency(report.totalB)}</div>
      </div>

      ${report.enableDepreciation !== false ? `
      <div class="pdf-row" style="margin-bottom: 2px;">
        <div style="flex-grow: 1; text-align: left; padding-left: 20mm; font-size: 10pt;">
          Depreciation @${report.depreciationPct}% per year from (${report.valuationYear} - ${report.constructionYear}) = ${report.structureAge} years, i.e ${report.depreciationPct} x ${report.structureAge} =
        </div>
        <div style="width: 65mm; display: flex; justify-content: space-between; flex-shrink: 0; align-items: baseline;">
          <span style="width: 20mm; text-align: right;">${report.totalDepreciationPct.toFixed(2)}% =</span>
          <span style="width: 45mm; text-align: right;">Rs. -${formatIndianCurrency(report.depreciationAmount)}</span>
        </div>
      </div>

      <!-- Line above TOTAL -->
      <div style="display: flex; justify-content: flex-end; margin-top: 2px; margin-bottom: 2px;">
        <div style="width: 105mm; border-top: 1px solid #000;"></div>
      </div>

      <div class="pdf-row" style="font-weight: bold; margin-bottom: 4px;">
        <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">TOTAL After Depreciation =</div>
        <div style="width: 45mm; text-align: right;">Rs. ${formatIndianCurrency(report.totalAfterDepreciation)}</div>
      </div>
      ` : `
      <div class="pdf-row" style="font-weight: bold; margin-bottom: 4px;">
        <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">TOTAL =</div>
        <div style="width: 45mm; text-align: right;">Rs. ${formatIndianCurrency(report.totalAfterDepreciation)}</div>
      </div>
      `}
      </div>
  `;

  let serviceItemsHtml = '';
  const hasCustomServices = report.customServices && report.customServices.length > 0;
  if (report.addSanitary || report.addElectrification || hasCustomServices) {
    serviceItemsHtml += `
      <div class="pdf-service-block" style="margin-top: 4mm; color: #000000; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.45;">
        <div class="pdf-row" style="font-weight: bold; margin-bottom: 2px;">
          <div style="flex-grow: 1;">Service Item:</div>
        </div>
    `;
    if (report.addSanitary) {
      serviceItemsHtml += `
        <div class="pdf-row" style="margin-bottom: 2px;">
          <div style="margin-left: 20mm; flex-grow: 1;">. Add for Sanitary & Water Supply Fittings</div>
          <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            <span style="display: inline-block; width: 15mm; text-align: left; font-weight: normal;">L/S =</span>
            <span>Rs. ${formatIndianCurrency(report.sanitaryCost)}</span>
          </div>
        </div>
      `;
    }
    if (report.addElectrification) {
      serviceItemsHtml += `
        <div class="pdf-row" style="margin-bottom: 2px;">
          <div style="margin-left: 20mm; flex-grow: 1;">. Add for Electrification</div>
          <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            <span style="display: inline-block; width: 15mm; text-align: left; font-weight: normal;">L/S =</span>
            <span>Rs. ${formatIndianCurrency(report.electrificationCost)}</span>
          </div>
        </div>
      `;
    }
    if (hasCustomServices) {
      report.customServices.forEach(cs => {
        serviceItemsHtml += `
          <div class="pdf-row" style="margin-bottom: 2px;">
            <div style="margin-left: 20mm; flex-grow: 1;">. ${cs.description || 'Add custom item'}</div>
            <div style="width: 45mm; text-align: right; font-weight: bold; flex-shrink: 0;">
              <span style="display: inline-block; width: 15mm; text-align: left; font-weight: normal;">L/S =</span>
              <span>Rs. ${formatIndianCurrency(cs.cost)}</span>
            </div>
          </div>
        `;
      });
    }
    serviceItemsHtml += `</div>`;
  }

  let grandTotalHtml = `
    <!-- Line above GRAND TOTAL -->
    <div style="border-top: 1.5px solid #000; margin-top: 5mm; margin-bottom: 2px; width: 100%;"></div>
    
    <div class="pdf-row" style="font-weight: bold; font-size: 11pt; font-family: Arial, Helvetica, sans-serif; color: #000000; line-height: 1.5;">
      <div style="flex-grow: 1; text-align: right; padding-right: 10mm; letter-spacing: 0.5px;">GRAND TOTAL =</div>
      <div style="width: 45mm; text-align: right; font-size: 11.5pt;">Rs. ${formatIndianCurrency(report.grandTotal)}</div>
    </div>

    <!-- Line below GRAND TOTAL -->
    <div style="border-top: 1.5px solid #000; margin-top: 2px; margin-bottom: 4mm; width: 100%;"></div>

    <div style="font-weight: bold; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; color: #000000; padding-left: 20mm; margin-bottom: 6mm;">
      (${numberToIndianWords(report.grandTotal)}) only.
    </div>
  `;

  let cleanNbNote = report.nbNote || '';
  // Strip any leading "N.B:-", "N.B.", "NB:", etc. case-insensitively
  cleanNbNote = cleanNbNote.replace(/^(N\.B\.-|N\.B\.:-|NB:-|N\.B\. :|NB :|N\.B\.:|N\.B\s*:-|NB\s*:-)\s*/i, '');

  let nbHtml = '';
  if (cleanNbNote) {
    nbHtml = `
      <div class="pdf-nb-block" style="margin-top: 6mm; font-size: 10pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.45; text-align: justify; color: #000000;">
        <strong>N.B:-</strong> ${cleanNbNote}
      </div>
    `;
  }
  let profileHtml = '';
  let sitePlanProfileHtml = '';
  let prof = {};
  let sealsSize = '8.5pt';
  try {
    const savedProf = localStorage.getItem('valuroad_user_profile');
    let useThreeSeals = true;
    let includePdf = true;
    if (savedProf) {
      prof = JSON.parse(savedProf);
      useThreeSeals = prof.useThreeSeals !== false;
      includePdf = prof.includePdf !== false;
      if (prof.sealsFontSize) {
        sealsSize = prof.sealsFontSize;
      }
    }

    if (includePdf) {
      if (useThreeSeals) {
        const jeDesig = (prof.jeDesignation !== undefined ? prof.jeDesignation : 'Junior Engineer, PW(B&NH)D ,').replace(/\n/g, '<br>');
        const jeAddr = (prof.jeAddress !== undefined ? prof.jeAddress : 'Bokakhat & Dergaon Territorial\nBldg Sub-Division, Bokakhat').replace(/\n/g, '<br>');
        
        const aeeDesig = (prof.aeeDesignation !== undefined ? prof.aeeDesignation : 'Asstt. Executive Engineer, PW(B&NH)D ,').replace(/\n/g, '<br>');
        const aeeAddr = (prof.aeeAddress !== undefined ? prof.aeeAddress : 'Bokakhat & Dergaon Territorial\nBldg Sub-Division, Bokakhat').replace(/\n/g, '<br>');
        
        const eeDesig = (prof.eeDesignation !== undefined ? prof.eeDesignation : 'Executive Engineer, PW(B&NH)D ,').replace(/\n/g, '<br>');
        const eeAddr = (prof.eeAddress !== undefined ? prof.eeAddress : 'Golaghat District Territorial\nBldg Division, Golaghat').replace(/\n/g, '<br>');

        const jeBlock = `
          <div style="text-align: center; width: 32%; font-family: Arial, Helvetica, sans-serif; font-size: ${sealsSize}; line-height: 1.45; color: #000000;">
            <div style="height: 15mm;"></div>
            ${jeDesig ? `<div style="font-weight: bold;">${jeDesig}</div>` : ''}
            ${jeAddr ? `<div>${jeAddr}</div>` : ''}
          </div>`;
        
        const aeeBlock = `
          <div style="text-align: center; width: 32%; font-family: Arial, Helvetica, sans-serif; font-size: ${sealsSize}; line-height: 1.45; color: #000000;">
            <div style="height: 15mm;"></div>
            ${aeeDesig ? `<div style="font-weight: bold;">${aeeDesig}</div>` : ''}
            ${aeeAddr ? `<div>${aeeAddr}</div>` : ''}
          </div>`;

        const eeBlock = `
          <div style="text-align: center; width: 32%; font-family: Arial, Helvetica, sans-serif; font-size: ${sealsSize}; line-height: 1.45; color: #000000;">
            <div style="height: 15mm;"></div>
            ${eeDesig ? `<div style="font-weight: bold;">${eeDesig}</div>` : ''}
            ${eeAddr ? `<div>${eeAddr}</div>` : ''}
          </div>`;

        profileHtml = `
          <div class="pdf-seals-text" style="margin-top: 15mm; display: flex; justify-content: space-between; page-break-inside: avoid; break-inside: avoid; align-items: flex-start; gap: 4mm;">
            ${jeBlock}
            ${aeeBlock}
            ${eeBlock}
          </div>
        `;

        // Site Plan Page Profile HTML (Page 2)
        const showJe = prof.showJeOnSitePlan !== false;
        const showAee = !!prof.showAeeOnSitePlan;
        const showEe = !!prof.showEeOnSitePlan;
        
        // Count visible blocks to set width appropriately
        const visibleCount = (showJe ? 1 : 0) + (showAee ? 1 : 0) + (showEe ? 1 : 0);
        const blockWidth = visibleCount > 1 ? (98 / visibleCount) + '%' : '65mm';

        sitePlanProfileHtml = `
          <div class="pdf-seals-text" style="margin-top: 5mm; display: flex; justify-content: flex-start; page-break-inside: avoid; break-inside: avoid; align-items: flex-start; gap: 4mm;">
            ${showJe ? jeBlock.replace('width: 32%', `width: ${blockWidth}`) : ''}
            ${showAee ? aeeBlock.replace('width: 32%', `width: ${blockWidth}`) : ''}
            ${showEe ? eeBlock.replace('width: 32%', `width: ${blockWidth}`) : ''}
          </div>
        `;

      } else if (prof.name || prof.designation || prof.signatureBase64) {
        const standardProfile = `
          <div style="margin-top: 20mm; display: flex; justify-content: flex-end; page-break-inside: avoid; break-inside: avoid;">
            <div style="text-align: center; width: 65mm; font-family: Arial, Helvetica, sans-serif;">
              ${prof.signatureBase64 ? `<img src="${prof.signatureBase64}" style="max-height: 25mm; max-width: 60mm; margin-bottom: 2px;">` : '<div style="height: 15mm;"></div>'}
              <div style="font-weight: bold; font-size: 10.5pt; color: #000000;">${prof.name || ''}</div>
              <div style="font-size: 10pt; color: #1e293b;">${prof.designation || ''}</div>
            </div>
          </div>
        `;
        profileHtml = standardProfile;
        sitePlanProfileHtml = standardProfile;
      }
    }
  } catch(e) {
    console.error('Error loading profile for PDF', e);
  }

  // Define sitePlanProfileHtml if not defined
  if (typeof sitePlanProfileHtml === 'undefined') sitePlanProfileHtml = profileHtml;

  // ── PAGE 1: VALUATION ESTIMATE SHEET ────────────────────────────────────────
  const orgBlock = tpl.orgName ? `
    <div class="pdf-title" style="text-align:center;font-weight:bold;font-size:${parseFloat(tpl.fontSize)+1}pt;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:8px;">${tpl.orgName}</div>` : '';
  const subBlock = tpl.subtitle ? `
    <div class="pdf-title" style="text-align:center;font-weight:bold;font-size:${tpl.fontSize}pt;margin-bottom:10px;letter-spacing:0.5px;">${tpl.subtitle}</div>` : '';

  let html = `
    <div class="pdf-page" style="font-family: Arial, Helvetica, sans-serif; font-size:${tpl.fontSize}pt; color: #000000; --preview-seals-font-size: ${sealsSize};">
      ${orgBlock}
      ${subBlock}
      <div class="pdf-estimate-header pdf-meta" style="color: #000000; font-family: Arial, Helvetica, sans-serif; font-size: ${tpl.fontSize}pt; line-height: 1.6; margin-bottom: 6mm;">
        <div class="pdf-row" style="margin-bottom: 4px;">
          <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Name of Work</div>
          <div style="width: 5mm; text-align: center; font-weight: bold; flex-shrink: 0;">:</div>
          <div style="flex-grow: 1; font-weight: bold; text-align: justify; padding-right: 5mm;">${report.workName || 'N/A'}</div>
        </div>
        <div class="pdf-row" style="margin-bottom: 4px;">
          <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Name of Occupier</div>
          <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
          <div style="flex-grow: 1;">${report.clientName || 'N/A'}</div>
        </div>
        <div class="pdf-row" style="margin-bottom: 4px;">
          <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Village</div>
          <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
          <div style="flex-grow: 1;">${report.location || 'N/A'}</div>
        </div>
        <div class="pdf-row" style="margin-bottom: 4px;">
          <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Year of Construction</div>
          <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
          <div style="flex-grow: 1;">
            <span style="font-weight: bold;">${report.constructionYear || 'N/A'}</span>
            ${report.constructionYearComment ? `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${report.constructionYearComment}` : ''}
          </div>
        </div>
      </div>

      <div class="prep-basis" style="margin-top: 5mm; margin-bottom: 5mm; font-size: ${tpl.fontSize}pt; font-weight: 500; font-family: Arial, Helvetica, sans-serif; color: #000000;">
        This estimate is prepared on the basis of ${tpl.basisText}
      </div>

      <div class="pdf-items-list pdf-table-text">
        ${depreciatedItemsHtml}
      </div>

      <div class="pdf-table-text">
        ${subtotalsHtml}
      </div>

      <div class="pdf-excluded-list pdf-table-text">
        ${excludedItemsHtml}
      </div>

      <div class="pdf-table-text">
        ${serviceItemsHtml}
      </div>

      <div class="pdf-table-text">
        ${grandTotalHtml}
      </div>

      ${nbHtml}

      ${profileHtml}
    </div>
  `;

  // ── PAGE 2: LINE PLAN ────────────────────────────────────────────────────────
  const headerHtml = `
    <div class="pdf-estimate-header" style="color: #000000; font-family: Arial, Helvetica, sans-serif; font-size: ${tpl.fontSize}pt; line-height: 1.6; margin-bottom: 6mm;">
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Name of Work</div>
        <div style="width: 5mm; text-align: center; font-weight: bold; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1; font-weight: bold; text-align: justify; padding-right: 5mm;">${report.workName || 'N/A'}</div>
      </div>
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Name of Occupier</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1;">${report.clientName || 'N/A'}</div>
      </div>
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Location</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1;">${report.location || 'N/A'}</div>
      </div>
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Year of Construction</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1;">
          <span style="font-weight: bold;">${report.constructionYear || 'N/A'}</span>
          ${report.constructionYearComment ? `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${report.constructionYearComment}` : ''}
        </div>
      </div>
    </div>
  `;

  html += `
   <div class="pdf-page" style="page-break-before: always; font-family: Arial, Helvetica, sans-serif; color: #000000; display: flex; flex-direction: column; min-height: 270mm;">
     ${headerHtml}
     <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; background: #ffffff; margin-top: 5mm; margin-bottom: 5mm; padding: 5mm; border: 1px solid #e2e8f0; border-radius: 4px;">
       ${sketcherImage
         ? `<img src="${sketcherImage}" style="width: 100%; height: auto; max-height: ${tpl.linePlanHeight || '160mm'}; object-fit: contain;" />`
         : '<div style="color: #64748b; font-style: italic;">No drawing sketched</div>'}
     </div>
     <div style="text-align: center; font-weight: bold; font-size: 11pt; line-height: 1.3; margin-top: auto; padding-bottom: 5mm;">
       LINE PLAN / SITE LAYOUT<br>
       (Not to Scale)
     </div>
     ${sitePlanProfileHtml}
   </div>
  `;

  // ── PAGE 3: SITE PHOTO EVIDENCE ──────────────────────────────────────────────
  if (report.photos && report.photos.length > 0) {
    html += `
      <div class="pdf-page" style="page-break-before: always; font-family: Arial, Helvetica, sans-serif; color: #000000;">
        <h3 class="section-title" style="font-size: 14pt; font-weight: bold; margin-bottom: 15px; border-bottom: 1.5px solid #000000; padding-bottom: 4px;">SITE PHOTO EVIDENCE</h3>
        <div class="pdf-photo-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; margin-top: 5mm;">
    `;

    report.photos.forEach((ph, idx) => {
      html += `
        <div class="pdf-photo-card" style="border: 1px solid #cbd5e1; padding: 6px; background-color: #ffffff; border-radius: 4px;">
          <img src="${ph.data}" class="pdf-photo-img" style="width: 100%; height: ${tpl.photoHeight}; object-fit: cover;" />
          <div class="pdf-photo-caption" style="text-align: center; font-weight: bold; font-size: 9.5pt; margin-top: 6px; color: #000000;">Photo ${idx + 1}: ${ph.caption || 'Site View'}</div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  }

  // Populate the template in the DOM for test inspection
  const container = document.getElementById('pdf-template');
  if (container) {
    container.innerHTML = html;
  }

  // Run html2pdf options
  const opt = {
    margin: [tpl.margin, tpl.margin, tpl.margin, tpl.margin],
    filename: (() => {
      const cleanName = (report.clientName || 'Owner').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
      const rawPart = `Valuation_${cleanName}_${report.id}`.replace(/_+/g, '_');
      return rawPart.substring(0, 46).replace(/_$/, '') + '.pdf';
    })(),
    image: { type: 'jpeg', quality: tpl.imgQuality },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  if (isPrint === 'preview') {
    return html;
  }

  if (isPrint === true || isPrint === 'true') {
    html2pdf().from(html).set(opt).toPdf().outputPdf('blob').then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    }).catch(err => {
      console.error("Error generating print PDF:", err);
    });
  } else {
    // Generate PDF and trigger download
    html2pdf().from(html).set(opt).save();
  }
}