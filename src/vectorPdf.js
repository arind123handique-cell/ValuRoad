// Vector-based PDF generation engine using jsPDF and jsPDF-AutoTable plugin.
// This produces 100% crisp vector PDFs with selectable/searchable text.

export async function generateVectorPdf(container, filename, imgQuality, isPrint) {
  try {
    console.log("generateVectorPdf called:", { filename, imgQuality, isPrint, container });
    
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

    console.log("Resolved jsPDF constructor:", jsPDF);
    console.log("autoTable plugin registered:", typeof jsPDF.prototype.autoTable === 'function');

    // Get pages in preview
    const pages = container.querySelectorAll('.pdf-page, .preview-paper');
    console.log("Pages queried count:", pages.length);
    if (pages.length === 0) {
      throw new Error("No pages found to export.");
    }

  // Get active configurations from DOM
  const sizeEl = document.getElementById('prev-page-size');
  const size = sizeEl ? sizeEl.value : 'a4';
  const marginEl = document.getElementById('prev-page-margin');
  const margin = marginEl ? parseFloat(marginEl.value) || 10 : 10;

  // Font mappings to standard PDF core fonts
  const fontEl = document.getElementById('prev-font-family');
  const selectedFont = fontEl ? fontEl.value : 'Arial, Helvetica, sans-serif';
  let fontName = 'helvetica';
  if (selectedFont.includes('Times New Roman') || selectedFont.includes('serif')) {
    fontName = 'times';
  } else if (selectedFont.includes('Courier') || selectedFont.includes('monospace')) {
    fontName = 'courier';
  }

  let pdf = null;

  for (let i = 0; i < pages.length; i++) {
    const pageEl = pages[i];
    const isLandscape = pageEl.classList.contains('pdf-landscape') || pageEl.classList.contains('landscape');

    // Page format
    let format = 'a4';
    if (pageEl.classList.contains('size-letter')) format = 'letter';
    else if (pageEl.classList.contains('size-legal')) format = 'legal';
    else if (pageEl.classList.contains('size-a3')) format = 'a3';

    // Page dimensions in mm
    let pageWidth = 210;
    let pageHeight = 297;

    if (format === 'a4') {
      pageWidth = isLandscape ? 297 : 210;
      pageHeight = isLandscape ? 210 : 297;
    } else if (format === 'letter') {
      pageWidth = isLandscape ? 279 : 216;
      pageHeight = isLandscape ? 216 : 279;
    } else if (format === 'legal') {
      pageWidth = isLandscape ? 356 : 216;
      pageHeight = isLandscape ? 216 : 356;
    } else if (format === 'a3') {
      pageWidth = isLandscape ? 420 : 297;
      pageHeight = isLandscape ? 297 : 420;
    }

    if (!pdf) {
      pdf = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: format
      });
    } else {
      pdf.addPage(format, isLandscape ? 'landscape' : 'portrait');
    }

    // Set page defaults
    pdf.setFont(fontName);

    // If it's a photos page
    const photoGrid = pageEl.querySelector('.pdf-photo-grid');
    // If it's the site plan page
    const hasDrawing = pageEl.querySelector('img') && (isLandscape || pageEl.innerHTML.includes('LINE PLAN'));

    if (photoGrid) {
      // ── RENDER PHOTO PAGE (Portrait) ──
      let y = margin;
      
      // Page title
      pdf.setFontSize(14);
      pdf.setFont(fontName, 'bold');
      pdf.text("SITE PHOTO EVIDENCE", margin, y + 5);
      y += 8;

      // Draw underline
      pdf.setLineWidth(0.4);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 6;

      const photos = pageEl.querySelectorAll('.pdf-photo-card');
      const photoWidth = (pageWidth - (2 * margin) - 8) / 2;
      const photoHeight = 60; // 60mm height

      photos.forEach((card, idx) => {
        const img = card.querySelector('img');
        const captionEl = card.querySelector('.pdf-photo-caption');
        const caption = captionEl ? captionEl.textContent : `Photo ${idx + 1}`;

        if (img && img.src) {
          // Calculate grid position
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const xPos = margin + col * (photoWidth + 8);
          const yPos = y + row * (photoHeight + 15);

          // Add image
          try {
            pdf.addImage(img.src, 'JPEG', xPos, yPos, photoWidth, photoHeight);
          } catch (e) {
            console.error("Error adding photo to PDF:", e);
            pdf.rect(xPos, yPos, photoWidth, photoHeight);
            pdf.setFontSize(9);
            pdf.text("[Photo Image Load Error]", xPos + 5, yPos + 30);
          }

          // Caption
          pdf.setFontSize(9);
          pdf.setFont(fontName, 'bold');
          pdf.text(caption, xPos + (photoWidth / 2), yPos + photoHeight + 5, { align: 'center' });
        }
      });

    } else if (hasDrawing) {
      // ── RENDER SITE PLAN PAGE (Landscape) ──
      let y = margin;

      // Organization name header (centered)
      const orgNameEl = pageEl.querySelector('.pdf-org-name, .preview-org-name');
      if (orgNameEl) {
        pdf.setFontSize(13);
        pdf.setFont(fontName, 'bold');
        pdf.text(orgNameEl.textContent.trim(), pageWidth / 2, y + 4, { align: 'center' });
        y += 6;
      }

      // Drawing image
      const img = pageEl.querySelector('img');
      if (img && img.src) {
        const drawWidth = pageWidth - (2 * margin);
        const drawHeight = 110;
        const xPos = margin;
        const yPos = y + 2;

        try {
          pdf.addImage(img.src, 'PNG', xPos, yPos, drawWidth, drawHeight);
        } catch (e) {
          console.error("Error adding sketcher image to PDF:", e);
          pdf.rect(xPos, yPos, drawWidth, drawHeight);
        }
        y += drawHeight + 6;
      }

      // Drawing Label
      pdf.setFontSize(11);
      pdf.setFont(fontName, 'bold');
      pdf.text("LINE PLAN / SITE LAYOUT", pageWidth / 2, y + 2, { align: 'center' });
      pdf.setFont(fontName, 'normal');
      pdf.setFontSize(9);
      pdf.text("(Not to Scale)", pageWidth / 2, y + 6, { align: 'center' });

      // Signatures row
      const sigRow = pageEl.querySelector('.pdf-signature-row');
      if (sigRow) {
        // Read dragged position from DOM
        const paperHeightPx = pageEl.clientHeight || 794; // Landscape height in pixels
        const dragStyleTop = sigRow.style.top;
        let sigYM = pageHeight - margin - 25; // default near bottom

        if (dragStyleTop && dragStyleTop.includes('px')) {
          const dragPx = parseFloat(dragStyleTop);
          sigYM = dragPx * (pageHeight / paperHeightPx);
        }

        // Get columns (Je, Aee, Ee etc)
        let cols = sigRow.querySelectorAll('.pdf-col, [class*="col-"]');
        if (cols.length === 0) {
          cols = Array.from(sigRow.children);
        }

        if (cols.length > 0) {
          const style = window.getComputedStyle(sigRow);
          const justify = style.justifyContent || 'space-between';
          const colWidth = 65; // standard column width in mm

          cols.forEach((col, idx) => {
            let xPos = margin;
            if (cols.length === 1) {
              if (justify.includes('end')) {
                xPos = pageWidth - margin - colWidth;
              } else if (justify.includes('center')) {
                xPos = (pageWidth / 2) - (colWidth / 2);
              } else {
                xPos = margin;
              }
            } else {
              const totalAvailableWidth = pageWidth - (2 * margin);
              const step = totalAvailableWidth / cols.length;
              xPos = margin + idx * step + (step / 2) - (colWidth / 2);
            }

            const img = col.querySelector('img');
            let lineY = sigYM;

            if (img && img.src) {
              const imgW = 40;
              const imgH = 15;
              const imgX = xPos + (colWidth / 2) - (imgW / 2);
              try {
                pdf.addImage(img.src, 'PNG', imgX, lineY, imgW, imgH);
              } catch (e) {
                console.error("Error adding signature image:", e);
              }
              lineY += imgH + 2;
            } else {
              lineY += 10;
            }

            const sigText = col.innerText.split('\n').filter(t => t.trim());
            sigText.forEach(line => {
              pdf.setFontSize(9);
              pdf.setFont(fontName, (line.includes('Signature') || line.includes('Seal')) ? 'normal' : 'bold');
              pdf.text(line, xPos + (colWidth / 2), lineY, { align: 'center' });
              lineY += 4.5;
            });
          });
        }
      }

    } else {
      // ── RENDER ESTIMATE PAGES (Portrait) ──
      let y = margin;

      // Draw Letterhead on first page
      if (i === 0) {
        const orgNameEl = pageEl.querySelector('.pdf-org-name');
        if (orgNameEl) {
          pdf.setFontSize(14);
          pdf.setFont(fontName, 'bold');
          pdf.text(orgNameEl.textContent.trim(), pageWidth / 2, y + 4, { align: 'center' });
          y += 6;
        }

        const orgSubEl = pageEl.querySelector('.pdf-org-sub');
        if (orgSubEl) {
          pdf.setFontSize(9.5);
          pdf.setFont(fontName, 'normal');
          const lines = orgSubEl.innerText.split('\n');
          lines.forEach(line => {
            pdf.text(line.trim(), pageWidth / 2, y + 2, { align: 'center' });
            y += 4.5;
          });
          y += 2;
        }

        // Divider line
        pdf.setLineWidth(0.4);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 6;

        // Metadata rows
        const metaRows = pageEl.querySelectorAll('.pdf-meta .pdf-row');
        pdf.setFontSize(9.5);
        metaRows.forEach(row => {
          const cols = row.children;
          if (cols.length >= 3) {
            const label = cols[0].textContent.trim();
            const value = cols[2].textContent.trim();

            pdf.setFont(fontName, 'bold');
            pdf.text(label, margin, y + 2);
            pdf.text(":", margin + 42, y + 2);
            
            pdf.setFont(fontName, 'normal');
            // Wrap text for value if too long
            const valLines = pdf.splitTextToSize(value, pageWidth - margin - (margin + 45));
            pdf.text(valLines, margin + 45, y + 2);
            
            y += valLines.length * 4.5 + 1;
          }
        });
        y += 2;

        // Basis Text
        const prepBasis = pageEl.querySelector('.prep-basis');
        if (prepBasis) {
          pdf.setFont(fontName, 'bold');
          pdf.setFontSize(9.5);
          const basisLines = pdf.splitTextToSize(prepBasis.textContent.trim(), pageWidth - (2 * margin));
          pdf.text(basisLines, margin, y + 2);
          y += basisLines.length * 4.5 + 4;
        }
      }

      // Render Tables
      const tables = pageEl.querySelectorAll('table');
      for (let t = 0; t < tables.length; t++) {
        const table = tables[t];
        
        // Use jsPDF-AutoTable html parser
        pdf.autoTable({
          html: table,
          startY: y,
          theme: 'grid',
          styles: {
            fontSize: 8.5,
            font: fontName,
            textColor: [0, 0, 0],
            cellPadding: 1.5,
            lineColor: [180, 180, 180],
            lineWidth: 0.15
          },
          headStyles: {
            fillColor: [240, 243, 248],
            textColor: [0, 0, 0],
            fontStyle: 'bold'
          },
          margin: { left: margin, right: margin },
          didParseCell: function (data) {
            // Apply text alignment from HTML styles
            if (data.cell.raw) {
              const style = window.getComputedStyle(data.cell.raw);
              if (style.textAlign === 'right' || style.textAlign === 'end') {
                data.cell.styles.halign = 'right';
              } else if (style.textAlign === 'center') {
                data.cell.styles.halign = 'center';
              }

              // Bold if text-weight is bold
              if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 600) {
                data.cell.styles.fontStyle = 'bold';
              }
            }
          }
        });

        y = pdf.lastAutoTable.finalY + 5;
      }

      // Render N.B. Note
      const nbNotes = pageEl.querySelectorAll('.pdf-nb-box, .summary-box:not(table)');
      nbNotes.forEach(box => {
        if (box.tagName.toLowerCase() !== 'table') {
          pdf.setFont(fontName, 'normal');
          pdf.setFontSize(9);
          const lines = pdf.splitTextToSize(box.innerText.trim(), pageWidth - (2 * margin));
          pdf.text(lines, margin, y + 2);
          y += lines.length * 4.5 + 4;
        }
      });

      // Render profile/signatures rows on estimate pages
      const sigRow = pageEl.querySelector('.pdf-signature-row');
      if (sigRow) {
        // Read dragged position from DOM
        const paperHeightPx = pageEl.clientHeight || 1120; // Portrait height in pixels
        const dragStyleTop = sigRow.style.top;
        let sigYM = pageHeight - margin - 25; // default near bottom

        if (dragStyleTop && dragStyleTop.includes('px')) {
          const dragPx = parseFloat(dragStyleTop);
          sigYM = dragPx * (pageHeight / paperHeightPx);
        }

        // Get columns
        let cols = sigRow.querySelectorAll('.pdf-col, [class*="col-"]');
        if (cols.length === 0) {
          cols = Array.from(sigRow.children);
        }

        if (cols.length > 0) {
          const style = window.getComputedStyle(sigRow);
          const justify = style.justifyContent || 'space-between';
          const colWidth = 65; // standard column width in mm

          cols.forEach((col, idx) => {
            let xPos = margin;
            if (cols.length === 1) {
              if (justify.includes('end')) {
                xPos = pageWidth - margin - colWidth;
              } else if (justify.includes('center')) {
                xPos = (pageWidth / 2) - (colWidth / 2);
              } else {
                xPos = margin;
              }
            } else {
              const totalAvailableWidth = pageWidth - (2 * margin);
              const step = totalAvailableWidth / cols.length;
              xPos = margin + idx * step + (step / 2) - (colWidth / 2);
            }

            const img = col.querySelector('img');
            let lineY = sigYM;

            if (img && img.src) {
              const imgW = 40;
              const imgH = 15;
              const imgX = xPos + (colWidth / 2) - (imgW / 2);
              try {
                pdf.addImage(img.src, 'PNG', imgX, lineY, imgW, imgH);
              } catch (e) {
                console.error("Error adding signature image:", e);
              }
              lineY += imgH + 2;
            } else {
              lineY += 10;
            }

            const sigText = col.innerText.split('\n').filter(t => t.trim());
            sigText.forEach(line => {
              pdf.setFontSize(9);
              pdf.setFont(fontName, (line.includes('Signature') || line.includes('Seal')) ? 'normal' : 'bold');
              pdf.text(line, xPos + (colWidth / 2), lineY, { align: 'center' });
              lineY += 4.5;
            });
          });
        }
      }
    }
  }

  // Output
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
  } catch (err) {
    console.error("Error in generateVectorPdf:", err);
    throw err;
  }
}
