// ninepage.js
// Requires: pdf.js (pdfjsLib) and pdf-lib (PDFLib)
// Designed to work with your style.css from earlier.

(function () {
  // configure pdf.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  }

  const convertBtn = document.getElementById("convertBtn");
  const pdfInput = document.getElementById("pdfInput");
  const statusEl = document.getElementById("status");

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  convertBtn.addEventListener("click", async () => {
    try {
      setStatus("");
      const file = pdfInput.files[0];
      if (!file) {
        alert("Please choose a PDF file first.");
        return;
      }

      setStatus("Loading PDF...");
      const arrayBuffer = await file.arrayBuffer();

      // Load using PDF.js for rendering pages to images (robust for long/continuous pages)
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      setStatus(`Rendering ${pdf.numPages} pages to images...`);

      // Render pages to images (thumbnails). Scale down to avoid huge textures.
      const images = [];
      const renderScale = 4.0; // set lower if very large pages; 0.5 for heavy docs
      for (let i = 1; i <= pdf.numPages; ++i) {
        setStatus(`Rendering page ${i} / ${pdf.numPages}...`);
        const page = await pdf.getPage(i);

        // Choose a scale that keeps the thumbnail reasonable.
        // If the page has enormous height, downscale more.
        // Determine a scale based on page width (target about 800px max)
        const viewport1 = page.getViewport({ scale: 1 });
        let scale = renderScale;
        const maxDim = 1400; // max pixel dimension for the canvas side
        if (viewport1.width > maxDim) {
          scale = (maxDim / viewport1.width);
        }
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d");

        // White background to avoid transparent backgrounds for scanned pages
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;

        // Use JPEG for smaller size; quality 0.85
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        images.push(dataUrl);

        // free memory
        canvas.width = 1;
        canvas.height = 1;
      }

      setStatus("Creating 9-in-1 PDF...");

      // Create new PDF using pdf-lib and place images (9 per A4)
      const outPdf = await PDFLib.PDFDocument.create();
      const A4 = PDFLib.PageSizes.A4; // [595.28, 841.89]

      let idx = 0;
      const total = images.length;

      while (idx < total) {
        const page = outPdf.addPage(A4);
        const { width: pageW, height: pageH } = page.getSize();

        const cols = 3;
        const rows = 3;
        const cellW = pageW / cols;
        const cellH = pageH / rows;
        const padding = 6; // small padding inside each cell

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (idx >= total) break;

            const dataUrl = images[idx];
            let img;
            try {
              if (dataUrl.startsWith("data:image/png")) {
                img = await outPdf.embedPng(dataUrl);
              } else {
                img = await outPdf.embedJpg(dataUrl);
              }
            } catch (err) {
              // fallback: try to convert to PNG via an intermediate canvas
              console.warn("embed failed, trying canvas fallback", err);
              img = await fallbackEmbedFromDataUrl(outPdf, dataUrl);
            }

            // compute scaling so image fits inside cell with padding
            const maxW = cellW - padding * 2;
            const maxH = cellH - padding * 2;
            const scale = Math.min(maxW / img.width, maxH / img.height, 1);

            const drawW = img.width * scale;
            const drawH = img.height * scale;

            const x = c * cellW + (cellW - drawW) / 2;
            const y = pageH - (r + 1) * cellH + (cellH - drawH) / 2;

            page.drawImage(img, { x, y, width: drawW, height: drawH });

            idx++;
          }
        }
      }

      setStatus("Saving final PDF...");
      const finalBytes = await outPdf.save();

      // create download
      const blob = new Blob([finalBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/(\.pdf)?$/i, "_9in1.pdf");
      a.click();
      URL.revokeObjectURL(url);

      setStatus("Done — file downloaded.");
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      console.error(err);
      alert("An error occurred: " + (err.message || err));
      setStatus("");
    }
  });

  // Helper: if embedJpg/embedPng fails for any reason, convert via canvas and embed as PNG
  async function fallbackEmbedFromDataUrl(pdfDoc, dataUrl) {
    return new Promise((resolve) => {
      const imgEl = new Image();
      imgEl.onload = async function () {
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgEl, 0, 0);
        const png = canvas.toDataURL("image/png");
        const embedded = await pdfDoc.embedPng(png);
        // cleanup
        canvas.width = 1;
        canvas.height = 1;
        resolve(embedded);
      };
      imgEl.onerror = function () {
        // create a 1x1 white fallback image
        const canvas = document.createElement("canvas");
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL("image/png");
        pdfDoc.embedPng(png).then((emb) => resolve(emb));
      };
      imgEl.src = dataUrl;
    });
  }
})();

