import { getPdfTemplateSettings } from './app.js';

const SITE_PLAN_MARGIN_MM = 4;

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

  const unit = (item.unit || '').toLowerCase();
  const isFeet = ['sqf', 'sqft', 'ft', 'rft'].some(u => unit.includes(u));
  const isMetric = ['sqm', 'cum', 'm', 'rm'].some(u => unit.includes(u));

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
        if (isFeet) {
          const partsFeet = [];
          const partsMeters = [];
          if (hasL) { partsFeet.push(l.toFixed(2) + ' ft'); partsMeters.push((l * 0.3048).toFixed(2) + ' m'); }
          if (hasB) { partsFeet.push(b.toFixed(2) + ' ft'); partsMeters.push((b * 0.3048).toFixed(2) + ' m'); }
          if (hasH) { partsFeet.push(h.toFixed(2) + ' ft'); partsMeters.push((h * 0.3048).toFixed(2) + ' m'); }
          dimStr = `${partsFeet.join(' × ')}<br><span style="font-size: 8pt; color: #475569; font-weight: normal;">(${partsMeters.join(' × ')})</span>`;
        } else if (isMetric) {
          const partsMeters = [];
          const partsFeet = [];
          if (hasL) { partsMeters.push(l.toFixed(2) + ' m'); partsFeet.push((l * 3.28084).toFixed(1) + ' ft'); }
          if (hasB) { partsMeters.push(b.toFixed(2) + ' m'); partsFeet.push((b * 3.28084).toFixed(1) + ' ft'); }
          if (hasH) { partsMeters.push(h.toFixed(2) + ' m'); partsFeet.push((h * 3.28084).toFixed(1) + ' ft'); }
          dimStr = `${partsMeters.join(' × ')}<br><span style="font-size: 8pt; color: #475569; font-weight: normal;">(${partsFeet.join(' × ')})</span>`;
        } else {
          const parts = [];
          if (hasL) parts.push(l.toFixed(2));
          if (hasB) parts.push(b.toFixed(2));
          if (hasH) parts.push(h.toFixed(2));
          dimStr = parts.join(' × ');
        }
      }

      let subQtyHtml = '';
      if (isFeet) {
        let convertedQty = subQty;
        let dualUnit = '';
        if (unit.includes('sqf')) {
          convertedQty = subQty * 0.092903;
          dualUnit = 'sqm';
        } else if (unit.includes('cum')) {
          convertedQty = subQty;
        } else {
          convertedQty = subQty * 0.3048;
          dualUnit = 'm';
        }
        subQtyHtml = `${(parseFloat(subQty) || 0).toFixed(2)}<br><span style="font-size: 8pt; color: #475569; font-weight: normal;">(${convertedQty.toFixed(2)} ${dualUnit})</span>`;
      } else if (isMetric) {
        let convertedQty = subQty;
        let dualUnit = '';
        if (unit.includes('sqm')) {
          convertedQty = subQty * 10.76391;
          dualUnit = 'sqft';
        } else if (unit.includes('cum')) {
          convertedQty = subQty * 35.3147;
          dualUnit = 'cft';
        } else {
          convertedQty = subQty * 3.28084;
          dualUnit = 'ft';
        }
        subQtyHtml = `${(parseFloat(subQty) || 0).toFixed(2)}<br><span style="font-size: 8pt; color: #475569; font-weight: normal;">(${convertedQty.toFixed(2)} ${dualUnit})</span>`;
      } else {
        subQtyHtml = `${(parseFloat(subQty) || 0).toFixed(2)}`;
      }

      return `
        <tr>
          <td style="padding: 2px 4px; text-align: left; vertical-align: top;">${m.description || ''}</td>
          <td style="padding: 2px 4px; text-align: center; width: 30px; vertical-align: top;">${nos}</td>
          <td style="padding: 2px 4px; text-align: left; color: #334155; vertical-align: top; line-height: 1.25;">${dimStr}</td>
          <td style="padding: 2px 4px; text-align: right; font-weight: 600; width: 90px; vertical-align: top; line-height: 1.25;">${subQtyHtml}</td>
        </tr>
      `;
    }).join('');

    let totalQtyHtml = `${item.quantity.toFixed(2)} ${item.unit}`;
    if (isFeet) {
      let convertedQty = item.quantity;
      let dualUnit = '';
      if (unit.includes('sqf')) {
        convertedQty = item.quantity * 0.092903;
        dualUnit = 'sqm';
      } else if (unit.includes('cum')) {
        convertedQty = item.quantity;
      } else {
        convertedQty = item.quantity * 0.3048;
        dualUnit = 'm';
      }
      totalQtyHtml += `<br><span style="font-size: 8pt; color: #475569; font-weight: normal;">(${convertedQty.toFixed(2)} ${dualUnit})</span>`;
    } else if (isMetric) {
      let convertedQty = item.quantity;
      let dualUnit = '';
      if (unit.includes('sqm')) {
        convertedQty = item.quantity * 10.76391;
        dualUnit = 'sqft';
      } else if (unit.includes('cum')) {
        convertedQty = item.quantity * 35.3147;
        dualUnit = 'cft';
      } else {
        convertedQty = item.quantity * 3.28084;
        dualUnit = 'ft';
      }
      totalQtyHtml += `<br><span style="font-size: 8pt; color: #475569; font-weight: normal;">(${convertedQty.toFixed(2)} ${dualUnit})</span>`;
    }

    measurementRowsHtml = `
      <div style="margin-left: 20mm; margin-bottom: 3px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 9.5pt; border-top: 1px solid #cbd5e1;">
          <thead>
            <tr style="color: #64748b; font-size: 8.5pt;">
              <th style="padding: 1px 4px; text-align: left; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Description</th>
              <th style="padding: 1px 4px; text-align: center; width: 30px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Nos</th>
              <th style="padding: 1px 4px; text-align: left; font-weight: 600; border-bottom: 1px solid #e2e8f0;">L × B × H</th>
              <th style="padding: 1px 4px; text-align: right; width: 90px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${mRowsHtml}
          </tbody>
          <tfoot>
            <tr style="font-weight: 700; border-top: 1px solid #cbd5e1;">
              <td colspan="3" style="padding: 4px 4px; text-align: right; font-size: 9pt; vertical-align: top;">Total</td>
              <td style="padding: 4px 4px; text-align: right; vertical-align: top; line-height: 1.25;">${totalQtyHtml}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  } else {
    // Fallback: no measurements
    let dualQtyText = '';
    if (isFeet) {
      let convertedQty = item.quantity;
      let dualUnit = '';
      if (unit.includes('sqf')) {
        convertedQty = item.quantity * 0.092903;
        dualUnit = 'sqm';
      } else if (unit.includes('cum')) {
        convertedQty = item.quantity;
      } else {
        convertedQty = item.quantity * 0.3048;
        dualUnit = 'm';
      }
      dualQtyText = ` (${convertedQty.toFixed(2)} ${dualUnit})`;
    } else if (isMetric) {
      let convertedQty = item.quantity;
      let dualUnit = '';
      if (unit.includes('sqm')) {
        convertedQty = item.quantity * 10.76391;
        dualUnit = 'sqft';
      } else if (unit.includes('cum')) {
        convertedQty = item.quantity * 35.3147;
        dualUnit = 'cft';
      } else {
        convertedQty = item.quantity * 3.28084;
        dualUnit = 'ft';
      }
      dualQtyText = ` (${convertedQty.toFixed(2)} ${dualUnit})`;
    }

    measurementRowsHtml = `
      <div class="pdf-row" style="margin-bottom: 1px;">
        <div style="margin-left: 20mm; width: 40mm; flex-shrink: 0;">Quantity</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1; display: flex; justify-content: flex-end; padding-right: 45mm;">
          <span style="width: 35mm; text-align: left;">x &nbsp;&nbsp;&nbsp;&nbsp; ${item.quantity.toFixed(2)} ${item.unit} =</span>
          <span style="width: 30mm; text-align: right;">${item.quantity.toFixed(2)} ${item.unit}${dualQtyText}</span>
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
        ${item.rooms.map(r => {
          const l_m = parseFloat(r.l).toFixed(2);
          const w_m = parseFloat(r.w).toFixed(2);
          const area_sqm = parseFloat(r.areaSqm).toFixed(2);
          
          if (item.unit === 'sqf') {
            const l_ft = (parseFloat(r.l) * 3.28084).toFixed(1);
            const w_ft = (parseFloat(r.w) * 3.28084).toFixed(1);
            const area_sqft = (parseFloat(r.areaSqm) * 10.76391).toFixed(2);
            return `
              <div class="pdf-row" style="margin-bottom: 2px;">
                <div style="width: 25mm; flex-shrink: 0;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${r.name}</div>
                <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
                <div style="flex-grow: 1; display: flex; flex-direction: column; align-items: flex-end; padding-right: 45mm;">
                  <div style="display: flex; justify-content: flex-end; width: 100%;">
                    <span style="width: 45mm; text-align: left;">${l_m} m x ${w_m} m =</span>
                    <span style="width: 25mm; text-align: right;">${area_sqm} sqm</span>
                  </div>
                  <div style="display: flex; justify-content: flex-end; width: 100%; color: #475569; font-size: 9.5pt;">
                    <span style="width: 45mm; text-align: left;">(${l_ft} ft x ${w_ft} ft) =</span>
                    <span style="width: 25mm; text-align: right;">(${area_sqft} sqf)</span>
                  </div>
                </div>
              </div>
            `;
          } else {
            return `
              <div class="pdf-row" style="margin-bottom: 1px;">
                <div style="width: 25mm; flex-shrink: 0;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${r.name}</div>
                <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
                <div style="flex-grow: 1; display: flex; justify-content: flex-end; padding-right: 45mm;">
                  <span style="width: 45mm; text-align: left;">${l_m} m x ${w_m} m =</span>
                  <span style="width: 25mm; text-align: right;">${area_sqm} sqm</span>
                </div>
              </div>
            `;
          }
        }).join('')}
        
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
  try {
    const tpl = getPdfTemplateSettings();
    console.log("DEBUG: exportToPDF: report.jmsSlNo =", report.jmsSlNo, "tpl.showJmsSlNo =", tpl.showJmsSlNo);

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

  const contractorPct = report.contractorPct !== undefined ? report.contractorPct : (tpl.contractorPct !== undefined ? tpl.contractorPct : 15);
  const showContractorProfit = contractorPct > 0;

  let subtotalsHtml = '';
  
  if (showContractorProfit) {
    subtotalsHtml = `
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
          <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">Deduct. ${contractorPct}% for Contractors Profit =</div>
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
  } else {
    subtotalsHtml = `
      <div class="pdf-calc-block" style="margin-top: 5mm; margin-bottom: 5mm; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #000000;">
        <!-- Line above TOTAL -->
        <div style="display: flex; justify-content: flex-end; margin-bottom: 2px;">
          <div style="width: 105mm; border-top: 1px solid #000;"></div>
        </div>
        
        <div class="pdf-row" style="font-weight: bold; margin-bottom: 2px;">
          <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">TOTAL =</div>
          <div style="width: 45mm; text-align: right;">Rs. ${formatIndianCurrency(report.totalA)}</div>
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

        <!-- Line above TOTAL After Depreciation -->
        <div style="display: flex; justify-content: flex-end; margin-top: 2px; margin-bottom: 2px;">
          <div style="width: 105mm; border-top: 1px solid #000;"></div>
        </div>

        <div class="pdf-row" style="font-weight: bold; margin-bottom: 4px;">
          <div style="flex-grow: 1; text-align: right; padding-right: 10mm;">TOTAL After Depreciation =</div>
          <div style="width: 45mm; text-align: right;">Rs. ${formatIndianCurrency(report.totalAfterDepreciation)}</div>
        </div>
        ` : ''}
      </div>
    `;
  }

  let serviceItemsHtml = '';
  const hasCustomServices = report.customServices && report.customServices.length > 0;
  if (report.addSanitary || report.addElectrification || hasCustomServices) {
    const buildingBase = report.buildingBase || 0;
    serviceItemsHtml += `
      <div class="pdf-service-block" style="margin-top: 4mm; color: #000000; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.45;">
        <div class="pdf-row" style="font-weight: bold; margin-bottom: 3px;">
          <div style="flex-grow: 1;">Service Items:</div>
        </div>
        <div class="pdf-row" style="margin-bottom: 2px; font-size: 9pt; color: #1e293b;">
          <div style="margin-left: 10mm; flex-grow: 1;">Building Base (Plinth Area of Buildings) =</div>
          <div style="width: 55mm; text-align: right; font-weight: normal; flex-shrink: 0;">
            Rs. ${formatIndianCurrency(buildingBase)}
          </div>
        </div>
    `;
    if (report.addSanitary) {
      const sGross = report.sanitaryCostGross || report.sanitaryCost;
      const sPct = report.sanitaryPct || 3;
      const sDeductPct = report.sanitaryDeductPct || 0;
      const sDeductAmt = report.sanitaryDeductAmt || 0;
      serviceItemsHtml += `
        <div class="pdf-row" style="margin-bottom: 2px;">
          <div style="margin-left: 20mm; flex-grow: 1;">. Add for Sanitary & Water Supply Fittings</div>
          <div style="width: 65mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            <span style="display: inline-block; width: 35mm; text-align: left; font-weight: normal;">${formatIndianCurrency(buildingBase)} × ${sPct}% =</span>
            <span>Rs. ${formatIndianCurrency(sGross)}</span>
          </div>
        </div>
      `;
      if (sDeductPct > 0) {
        serviceItemsHtml += `
          <div class="pdf-row" style="margin-left: -5mm; margin-top: 1px;">
            <div style="flex-grow: 1; padding-left: 20mm;">Less ${sDeductPct}% Non-conformity deduction</div>
            <div style="width: 65mm; text-align: right; font-weight: bold; flex-shrink: 0;">
              = Rs. -${formatIndianCurrency(sDeductAmt)}
            </div>
          </div>
        `;
      }
      serviceItemsHtml += `
        <div class="pdf-row" style="margin-bottom: 2px; font-weight: bold; color: #000;">
          <div style="margin-left: 30mm; flex-grow: 1;">Net Sanitary Cost =</div>
          <div style="width: 65mm; text-align: right; flex-shrink: 0;">
            Rs. ${formatIndianCurrency(report.sanitaryCost || 0)}
          </div>
        </div>
      `;
    }
    if (report.addElectrification) {
      const eGross = report.electrificationCostGross || report.electrificationCost;
      const ePct = report.electrificationPct || 5;
      const eDeductPct = report.electrificationDeductPct || 0;
      const eDeductAmt = report.electrificationDeductAmt || 0;
      serviceItemsHtml += `
        <div class="pdf-row" style="margin-bottom: 2px;">
          <div style="margin-left: 20mm; flex-grow: 1;">. Add for Electrification</div>
          <div style="width: 65mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            <span style="display: inline-block; width: 35mm; text-align: left; font-weight: normal;">${formatIndianCurrency(buildingBase)} × ${ePct}% =</span>
            <span>Rs. ${formatIndianCurrency(eGross)}</span>
          </div>
        </div>
      `;
      if (eDeductPct > 0) {
        serviceItemsHtml += `
          <div class="pdf-row" style="margin-left: -5mm; margin-top: 1px;">
            <div style="flex-grow: 1; padding-left: 20mm;">Less ${eDeductPct}% Non-conformity deduction</div>
            <div style="width: 65mm; text-align: right; font-weight: bold; flex-shrink: 0;">
              = Rs. -${formatIndianCurrency(eDeductAmt)}
            </div>
          </div>
        `;
      }
      serviceItemsHtml += `
        <div class="pdf-row" style="margin-bottom: 2px; font-weight: bold; color: #000;">
          <div style="margin-left: 30mm; flex-grow: 1;">Net Electrification Cost =</div>
          <div style="width: 65mm; text-align: right; flex-shrink: 0;">
            Rs. ${formatIndianCurrency(report.electrificationCost || 0)}
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

  // PART-B: Injurious Affection — Staircase Acquisition (Section 94 RFCTLARR Act, 2013)
  let partBHtml = '';
  if (report.addStaircase) {
    const method = report.staircaseMethod || 'adverse-pct';
    const note = report.staircaseNote || '';
    partBHtml = `
      <div class="pdf-service-block" style="margin-top: 6mm; color: #000000; font-size: 10.5pt; font-family: Arial, Helvetica, sans-serif; line-height: 1.45;">
        <div class="pdf-row" style="font-weight: bold; font-size: 10.5pt; margin-bottom: 3px;">
          <div style="flex-grow: 1;">PART-B: INJURIOUS AFFECTION — STAIRCASE ACQUISITION (SECTION 94 RFCTLARR ACT, 2013)</div>
          <div style="width: 50mm; text-align: right; font-weight: bold; flex-shrink: 0;">
            <span>Rs. ${formatIndianCurrency(report.staircaseCost)}</span>
          </div>
        </div>
        <div style="margin-left: 5mm; font-size: 9pt; color: #1e293b; margin-bottom: 4px; text-align: justify; line-height: 1.5;">
          <strong>Technical Note:</strong> <em>${note}</em>
        </div>
    `;
    if (method === 'adverse-pct') {
      const totalFloors = report.staircaseFloors || 2;
      const affectedFloors = Math.max(0, totalFloors - 1);
      const floorMeasures = report.staircaseFloorMeasurements || [];
      const residualArea = floorMeasures.reduce((sum, fm) => {
        const g = (fm.l || 0) * (fm.b || 0);
        return sum + g * (1 - (fm.nonConfPct || 0) / 100);
      }, 0);
      const residualValue = residualArea * report.staircaseRate;
      const affPct = report.staircaseAffectionPct || 2;
      let calcLines = '';
      floorMeasures.forEach(fm => {
        const gross = (fm.l || 0) * (fm.b || 0);
        const ncp = fm.nonConfPct || 0;
        const net = gross * (1 - ncp / 100);
        calcLines += `${fm.floorLabel} L×B = ${(fm.l || 0).toFixed(2)} m × ${(fm.b || 0).toFixed(2)} m = ${gross.toFixed(2)} sqm`;
        if (ncp > 0) calcLines += ` (less ${ncp}% NC${fm.nonConfReason ? ': ' + fm.nonConfReason : ''} → ${net.toFixed(2)} sqm)`;
        calcLines += `<br>`;
      });
      calcLines += `<br>`;
      calcLines += `Total Residual Built-up Area (after NC deductions) = ${residualArea.toFixed(2)} sqm<br>`;
      calcLines += `Building Type = ${totalFloors}-storey (${totalFloors} floors). Upper floors inaccessible = ${affectedFloors} nos.<br>`;

      calcLines += `Residual Building Value = ${residualArea.toFixed(2)} sqm @ Rs. ${formatIndianCurrency(Math.round(report.staircaseRate || 0))}/sqm = Rs. ${formatIndianCurrency(Math.round(residualValue))}<br>`;
      calcLines += `Affection Level = ${affPct}%<br>`;
      calcLines += `<b>Compensation = Rs. ${formatIndianCurrency(Math.round(residualValue))} × ${affPct}% = Rs. ${formatIndianCurrency(report.staircaseCost)}</b>`;
      partBHtml += `
        <div style="margin-left: 10mm; margin-top: 3px; font-size: 9pt; color: #1e293b; line-height: 1.7; font-family: 'Courier New', monospace; background: #f8fafc; padding: 4px 8px;">
          ${calcLines}
        </div>
      `;
    } else if (method === 'restoration') {
      const restItems = report.staircaseRestorationItems || [];
      const foundationCost = (report.staircaseFoundationSqm || 0) * (report.staircaseFoundationRate || 0);
      const restSubtotal = (report.staircaseRestorationTotal || 0) + foundationCost;
      let calcLines = `<b>Itemised Construction Works:</b><br>`;
      restItems.forEach(ri => {
        const hasLxB = ri.unit === 'sqm' && (ri.l || 0) > 0 && (ri.b || 0) > 0;
        const lxbStr = hasLxB ? ` [L×B: ${(ri.l || 0).toFixed(2)} m × ${(ri.b || 0).toFixed(2)} m]` : '';
        calcLines += `${ri.description || 'Item'}: ${(ri.quantity || 0).toFixed(2)} ${ri.unit || 'nos'}${lxbStr} @ Rs. ${formatIndianCurrency(Math.round(ri.rate || 0))}/sqm = Rs. ${formatIndianCurrency(Math.round(ri.cost || 0))}<br>`;
      });
      calcLines += `<br>`;
      calcLines += `Subtotal (Construction Items) = Rs. ${formatIndianCurrency(Math.round(report.staircaseRestorationTotal || 0))}<br>`;
      if (foundationCost > 0) {
        calcLines += `Foundation Strengthening: ${(report.staircaseFoundationSqm || 0).toFixed(2)} sqm @ Rs. ${formatIndianCurrency(Math.round(report.staircaseFoundationRate || 0))}/sqm = Rs. ${formatIndianCurrency(Math.round(foundationCost))}<br>`;
      }
      calcLines += `Total with Overheads = Rs. ${formatIndianCurrency(report.staircaseRestorationWithOverheads)}<br>`;
      if ((report.staircaseNonConfPct || 0) > 0) {
        calcLines += `Less: Non-Conformity Deduction @ ${report.staircaseNonConfPct}% (${report.staircaseNonConfReason || ''}) = Rs. ${formatIndianCurrency(report.staircaseNonConfDeduction || 0)}<br>`;
      }
      calcLines += `<b>Final Restoration Compensation = Rs. ${formatIndianCurrency(report.staircaseRestorationGrandTotal)}</b>`;
      partBHtml += `
        <div style="margin-left: 10mm; margin-top: 3px; font-size: 9pt; color: #1e293b; line-height: 1.7; font-family: 'Courier New', monospace; background: #f8fafc; padding: 4px 8px;">
          ${calcLines}
        </div>
      `;
    }
    partBHtml += `</div>`;
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
          <div class="pdf-seals-text pdf-signature-row" style="margin-top: 15mm; display: flex; justify-content: space-between; page-break-inside: avoid; break-inside: avoid; align-items: flex-start; gap: 4mm;">
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
          <div class="pdf-seals-text pdf-signature-row" style="margin-top: 5mm; display: flex; justify-content: flex-start; page-break-inside: avoid; break-inside: avoid; align-items: flex-start; gap: 4mm;">
            ${showJe ? jeBlock.replace('width: 32%', `width: ${blockWidth}`) : ''}
            ${showAee ? aeeBlock.replace('width: 32%', `width: ${blockWidth}`) : ''}
            ${showEe ? eeBlock.replace('width: 32%', `width: ${blockWidth}`) : ''}
          </div>
        `;

      } else if (prof.name || prof.designation || prof.signatureBase64) {
        const standardProfile = `
          <div class="pdf-signature-row" style="margin-top: 20mm; display: flex; justify-content: flex-end; page-break-inside: avoid; break-inside: avoid;">
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

  const orgBlock = tpl.orgName ? `
    <div class="pdf-title" style="text-align:center;font-weight:bold;font-size:${parseFloat(tpl.fontSize)+1}pt;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:8px;">${tpl.orgName}</div>` : '';
  const subBlock = tpl.subtitle ? `
    <div class="pdf-title" style="text-align:center;font-weight:bold;font-size:${tpl.fontSize}pt;margin-bottom:10px;letter-spacing:0.5px;">${tpl.subtitle}</div>` : '';

  // ── PREPARE PAGES ────────────────────────────────────────────────────────────
  // Get active page settings from DOM if available (real-time preview sync)
  let pageSize = 'a4';
  let pageOrient = 'portrait';
  let pageMargin = tpl.margin || 8;

  if (typeof document !== 'undefined') {
    const sizeEl = document.getElementById('prev-page-size');
    if (sizeEl) pageSize = sizeEl.value;

    const orientEl = document.getElementById('prev-page-orient');
    if (orientEl) pageOrient = orientEl.value;

    const marginEl = document.getElementById('prev-page-margin');
    if (marginEl) pageMargin = parseFloat(marginEl.value) || pageMargin;
  }

  let pageHeight = 297; // Default A4 height
  if (pageSize === 'letter') pageHeight = 279;
  else if (pageSize === 'legal') pageHeight = 356;
  else if (pageSize === 'a3') pageHeight = 420;

  if (pageOrient === 'landscape') {
    if (pageSize === 'a4') pageHeight = 210;
    else if (pageSize === 'letter') pageHeight = 216;
    else if (pageSize === 'legal') pageHeight = 216;
    else if (pageSize === 'a3') pageHeight = 297;
  }

  const printableHeight = pageHeight - (2 * pageMargin);

  // Helper to estimate height of an item in mm
  function estimateItemHeight(item) {
    let height = 20; // Base header
    if (item.description) height += 8;
    
    if (item.type === 'quantity-rate') {
      if (item.measurements && item.measurements.length > 0) {
        height += 8 + item.measurements.length * 6 + 8;
      } else {
        height += 8;
      }
      height += 8; // Rate line
      if (item.deductionPct > 0) height += 16;
    } else if (item.type === 'plinth-area') {
      height += 6; // Plinth area of building text
      if (item.rooms && item.rooms.length > 0) {
        height += item.rooms.length * 6;
      }
      height += 6; // Total Plinth Area
      if (item.unit === 'sqf' && parseFloat(item.totalAreaSqft) > 0) {
        height += 6; // Total Sqft Area
      }
      height += 8; // Rate line
      if (item.deductionPct > 0) height += 8; // Deduction line
    } else if (item.type === 'lump-sum') {
      height += 8; // Rate Line
      if (item.deductionPct > 0) height += 16;
    }
    height += 6; // margin-bottom
    return height;
  }

  // Estimate block heights for footer sections
  let subtotalHeight = 15;
  let subtotalLines = 4;
  if (report.enableDepreciation !== false) subtotalLines += 2;
  subtotalHeight = subtotalLines * 5 + 10;

  let serviceHeight = 0;
  if (report.addSanitary || report.addElectrification || (report.customServices && report.customServices.length > 0)) {
    let serviceLines = 1;
    if (report.addSanitary) serviceLines += 1;
    if (report.addElectrification) serviceLines += 1;
    if (report.customServices) serviceLines += report.customServices.length;
    serviceHeight = 4 + serviceLines * 5 + 10;
  }

  let partBHeight = 0;
  if (report.addStaircase) {
    const method = report.staircaseMethod || 'adverse-pct';
    const restItems = report.staircaseRestorationItems || [];
    let detailLines = 8; // header + method title + at least 5 detail lines + closing
    if (method === 'restoration') {
      detailLines += restItems.length; // one per restoration item
      if ((report.staircaseNonConfPct || 0) > 0) detailLines += 1;
    }
    partBHeight = 4 + detailLines * 5 + 10;
  }

  const grandTotalHeight = 25;

  let nbHeight = 0;
  if (cleanNbNote) {
    nbHeight = 6 + Math.ceil(cleanNbNote.length / 80) * 5 + 10;
  }

  let profileHeight = 0;
  if (profileHtml) {
    let useThreeSeals = true;
    let includePdf = true;
    try {
      const savedProf = localStorage.getItem('valuroad_user_profile');
      if (savedProf) {
        const prof = JSON.parse(savedProf);
        useThreeSeals = prof.useThreeSeals !== false;
        includePdf = prof.includePdf !== false;
      }
    } catch(e) {}
    if (includePdf) {
      profileHeight = useThreeSeals ? 50 : 45;
    }
  }

  // Build the list of printable blocks
  const blocks = [];
  
  if (depreciatedItems.length > 0) {
    depreciatedItems.forEach(item => {
      blocks.push({
        type: 'item',
        html: renderItem(item),
        height: estimateItemHeight(item)
      });
    });
  } else {
    blocks.push({
      type: 'empty-notice',
      html: `<div style="text-align: center; margin-top: 20mm; color: #64748b;">No items included in this valuation.</div>`,
      height: 30
    });
  }

  // Subtotals
  blocks.push({
    type: 'subtotals',
    html: `<div class="pdf-table-text">${subtotalsHtml}</div>`,
    height: subtotalHeight
  });

  // Excluded Items
  excludedItems.forEach(item => {
    blocks.push({
      type: 'item',
      html: renderItem(item),
      height: estimateItemHeight(item)
    });
  });

  // Service items
  if (report.addSanitary || report.addElectrification || (report.customServices && report.customServices.length > 0)) {
    blocks.push({
      type: 'services',
      html: `<div class="pdf-table-text">${serviceItemsHtml}</div>`,
      height: serviceHeight
    });
  }

  // PART-B: Injurious Affection
  if (report.addStaircase) {
    blocks.push({
      type: 'partb',
      html: `<div class="pdf-table-text">${partBHtml}</div>`,
      height: partBHeight
    });
  }

  // Grand Total
  blocks.push({
    type: 'grandtotal',
    html: `<div class="pdf-table-text">${grandTotalHtml}</div>`,
    height: grandTotalHeight
  });

  // N.B. Note
  if (cleanNbNote) {
    blocks.push({
      type: 'nb',
      html: nbHtml,
      height: nbHeight
    });
  }

  // Profile
  if (profileHtml) {
    blocks.push({
      type: 'profile',
      html: profileHtml,
      height: profileHeight
    });
  }

  // Put all blocks on a single continuous page to let the browser/PDF engine break pages naturally.
  let pages = [blocks];

  // Generate HTML for all pages
  let estimatePagesHtml = '';
  const firstPageHeader = orgBlock + subBlock + `
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
      ${(report.jmsSlNo && tpl.showJmsSlNo !== false) ? `
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">As per JMS report Sl NO</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1;">${report.jmsSlNo}</div>
      </div>
      ` : ''}
      ${report.enableDepreciation !== false ? `
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Year of Construction</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1;">
          <span style="font-weight: bold;">${report.constructionYear || 'N/A'}</span>
          ${report.constructionYearComment ? `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${report.constructionYearComment}` : ''}
        </div>
      </div>
      ` : ''}
    </div>
    <div class="prep-basis" style="margin-top: 5mm; margin-bottom: 5mm; font-size: ${tpl.fontSize}pt; font-weight: 500; font-family: Arial, Helvetica, sans-serif; color: #000000;">
      This estimate is prepared on the basis of ${tpl.basisText}
    </div>
  `;

  const subsequentPageHeader = '';

  pages.forEach((pageBlocks, pageIdx) => {
    const isFirst = (pageIdx === 0);
    const content = pageBlocks.map(b => b.html).join('');
    
    if (isFirst) {
      estimatePagesHtml += `
        <div class="pdf-page size-${pageSize}" style="font-family: Arial, Helvetica, sans-serif; font-size:${tpl.fontSize}pt; color: #000000; --preview-seals-font-size: ${sealsSize}; min-height: 270mm;">
          ${firstPageHeader}
          ${content}
        </div>
      `;
    } else {
      estimatePagesHtml += `
        <div class="pdf-page size-${pageSize}" style="font-family: Arial, Helvetica, sans-serif; font-size:${tpl.fontSize}pt; color: #000000; --preview-seals-font-size: ${sealsSize}; min-height: 270mm;">
          ${content}
        </div>
      `;
    }
  });

  let html = estimatePagesHtml;


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
      ${(report.jmsSlNo && tpl.showJmsSlNo !== false) ? `
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">As per JMS report Sl NO</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1;">${report.jmsSlNo}</div>
      </div>
      ` : ''}
      ${report.enableDepreciation !== false ? `
      <div class="pdf-row" style="margin-bottom: 4px;">
        <div style="width: 45mm; font-weight: bold; flex-shrink: 0;">Year of Construction</div>
        <div style="width: 5mm; text-align: center; flex-shrink: 0;">:</div>
        <div style="flex-grow: 1;">
          <span style="font-weight: bold;">${report.constructionYear || 'N/A'}</span>
          ${report.constructionYearComment ? `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${report.constructionYearComment}` : ''}
        </div>
      </div>
      ` : ''}
    </div>
  `;

  html += `
   <div class="pdf-page pdf-landscape pdf-site-plan-page size-${pageSize}" style="font-family: Arial, Helvetica, sans-serif; color: #000000; display: flex; flex-direction: column; justify-content: space-between; padding: ${SITE_PLAN_MARGIN_MM}mm; overflow: hidden;">
     ${headerHtml}
     <div style="flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; background: #ffffff; margin-top: 2mm; margin-bottom: 2mm; padding: 2mm; border: 1px solid #e2e8f0; border-radius: 4px; overflow: hidden;">
       ${sketcherImage
          ? `<img src="${sketcherImage}" style="width: 100%; height: 100%; object-fit: contain;" />`
          : '<div style="color: #64748b; font-style: italic;">No drawing sketched</div>'}
     </div>
     <div style="text-align: center; font-weight: bold; font-size: 11pt; line-height: 1.3; flex-shrink: 0; padding-bottom: 1mm;">
       LINE PLAN / SITE LAYOUT<br>
       (Not to Scale)
     </div>
     ${sitePlanProfileHtml}
   </div>
  `;

  // ── PAGE 3: SITE PHOTO EVIDENCE ──────────────────────────────────────────────
  if (report.photos && report.photos.length > 0) {
    html += `
      <div class="pdf-page size-${pageSize}" style="font-family: Arial, Helvetica, sans-serif; color: #000000;">
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

  if (!window.html2pdf) {
    const msg = 'PDF export library is not loaded yet. Please check your internet connection.';
    if (typeof alert === 'function') alert(msg);
    console.error(msg);
    return html;
  }

  // Generate page-by-page to allow true mixed portrait & landscape orientations
  generateMixedPdf(container, opt.filename, tpl.imgQuality, isPrint).catch(err => {
    console.error("Custom page-by-page PDF generation failed, using standard fallback:", err);
    if (isPrint === true || isPrint === 'true') {
      html2pdf().from(html).set(opt).toPdf().outputPdf('blob').then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
      }).catch(fallbackErr => {
        console.error("Error generating print PDF in fallback:", fallbackErr);
      });
    } else {
      html2pdf().from(html).set(opt).save();
    }
  });
  } catch (err) {
  console.error("Critical error in exportToPDF:", err);
  return `<div class="pdf-page" style="padding: 20mm; color: #b91c1c; font-family: sans-serif;">
    <h2 style="margin-bottom: 10px;">⚠️ PDF Generation Error</h2>
    <p style="margin-bottom: 10px;">An unexpected error occurred while generating the document preview.</p>
    <pre style="background: #fef2f2; padding: 10px; border-radius: 4px; font-size: 9pt; white-space: pre-wrap;">${err.message}</pre>
    <p style="margin-top: 10px; font-size: 10pt; color: #475569;">This usually happens if some data in the project is invalid or if a calculation failed.</p>
  </div>`;
  }
}

// Custom page-by-page generator to support mixed portrait/landscape PDF orientations
export async function generateMixedPdf(container, filename, imgQuality, isPrint) {
  let jsPDF = null;
  if (window.jspdf && typeof window.jspdf.jsPDF === 'function') {
    jsPDF = window.jspdf.jsPDF;
  } else if (typeof window.jsPDF === 'function') {
    jsPDF = window.jsPDF;
  } else if (typeof window.jspdf === 'function') {
    jsPDF = window.jspdf;
  }

  if (!jsPDF) {
    throw new Error("jsPDF library not found in global scope.");
  }
  async function renderPageToCanvas(pageEl, options) {
    if (typeof window.html2canvas === 'function') {
      return window.html2canvas(pageEl, options);
    }

    if (typeof window.html2pdf === 'function') {
      return window.html2pdf()
        .set({ html2canvas: options })
        .from(pageEl)
        .toCanvas()
        .get('canvas');
    }

    throw new Error("html2canvas renderer not found.");
  }

  const pages = container.querySelectorAll('.pdf-page, .preview-paper');
  if (pages.length === 0) {
    throw new Error("No pages found to export.");
  }

  // Backup original styles of the container to restore later
  const originalWidth = container.style.width;
  const originalMaxWidth = container.style.maxWidth;
  const originalMinWidth = container.style.minWidth;
  const originalBoxSizing = container.style.boxSizing;

  // Set ample width so that no portrait (210mm) or landscape (297mm) pages are squeezed or clipped
  container.style.width = '500mm';
  container.style.maxWidth = 'none';
  container.style.minWidth = '500mm';
  container.style.boxSizing = 'content-box';

  let pdf = null;

  try {
    for (let i = 0; i < pages.length; i++) {
      const pageEl = pages[i];
      
      // Determine landscape layout using classes or bounding box dimensions
      const rect = pageEl.getBoundingClientRect();
      const isLandscape = pageEl.classList.contains('pdf-landscape') || 
                          pageEl.classList.contains('landscape') || 
                          (rect.width > rect.height);
      // Force pageEl to maintain its exact dimensions during screenshot
      const originalPageWidth = pageEl.style.width;
      const originalPageHeight = pageEl.style.height;

      // Capture exact canvas dimensions
      const canvas = await renderPageToCanvas(pageEl, {
        scale: 2,
        useCORS: true,
        logging: false,
        width: pageEl.offsetWidth,
        height: pageEl.offsetHeight,
        scrollX: 0,
        scrollY: 0,
        windowWidth: document.documentElement.offsetWidth,
        windowHeight: document.documentElement.offsetHeight
      });

      const imgData = canvas.toDataURL('image/jpeg', imgQuality || 0.95);

      let format = 'a4';
      if (pageEl.classList.contains('size-letter')) format = 'letter';
      else if (pageEl.classList.contains('size-legal')) format = 'legal';
      else if (pageEl.classList.contains('size-a3')) format = 'a3';

      let pdfWidth = 210;
      let pdfHeight = 297;

      if (format === 'a4') {
        pdfWidth = isLandscape ? 297 : 210;
        pdfHeight = isLandscape ? 210 : 297;
      } else if (format === 'letter') {
        pdfWidth = isLandscape ? 279 : 216;
        pdfHeight = isLandscape ? 216 : 279;
      } else if (format === 'legal') {
        pdfWidth = isLandscape ? 356 : 216;
        pdfHeight = isLandscape ? 216 : 356;
      } else if (format === 'a3') {
        pdfWidth = isLandscape ? 420 : 297;
        pdfHeight = isLandscape ? 297 : 420;
      }

      if (!pdf) {
        pdf = new jsPDF({
          orientation: isLandscape ? 'l' : 'p',
          unit: 'mm',
          format: [pdfWidth, pdfHeight]
        });
      } else {
        pdf.addPage([pdfWidth, pdfHeight], isLandscape ? 'l' : 'p');
      }

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    }

    if (isPrint === 'bloburl') {
      const blob = pdf.output('blob');
      return URL.createObjectURL(blob);
    } else if (isPrint === true || isPrint === 'true') {
      const blob = pdf.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } else {
      pdf.save(filename);
    }
  } finally {
    // Restore original container style properties
    container.style.width = originalWidth;
    container.style.maxWidth = originalMaxWidth;
    container.style.minWidth = originalMinWidth;
    container.style.boxSizing = originalBoxSizing;
  }
}
