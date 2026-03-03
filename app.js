/* ===== Advertising Response Heterogeneity Dashboard ===== */
(() => {
    'use strict';

    // ---- Chart.js global config ----
    Chart.defaults.color = '#9ca3b8';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.animation.duration = 600;

    const COLORS = {
        blue: '#60a5fa',
        blueAlpha: 'rgba(96,165,250,0.75)',
        blueFaint: 'rgba(96,165,250,0.25)',
        indigo: '#818cf8',
        indigoAlpha: 'rgba(129,140,248,0.7)',
        cyan: '#22d3ee',
        green: '#34d399',
        gray: 'rgba(156,163,184,0.4)',
        grayLine: 'rgba(156,163,184,0.5)',
        white12: 'rgba(255,255,255,0.12)',
    };

    // ---- Simplified US state outlines for map (lon, lat boundary points) ----
    // Continental US bounding box: lat 24.5–49.5, lon -125 to -66.5
    const US_BOUNDS = { minLat: 24.5, maxLat: 49.5, minLon: -125, maxLon: -66.5 };

    // ---- DOM ----
    const brandSelect = document.getElementById('brand-select');
    const brandMeta = document.getElementById('brand-meta');
    const kpiValue = document.getElementById('kpi-value');
    const dmaSelect = document.getElementById('dma-select');
    const genDate = document.getElementById('gen-date');
    const mapCanvas = document.getElementById('dma-map-canvas');

    let currentBrand = null;
    let charts = {};

    let p05Global, p95Global;  // percentile bounds

    // ---- Initialize ----
    function init() {
        genDate.textContent = new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // All brands sorted numerically
        const allBrands = Object.keys(DASHBOARD_DATA).sort((a, b) => {
            const numA = parseInt(a.split(' ')[1]);
            const numB = parseInt(b.split(' ')[1]);
            return numA - numB;
        });

        // Compute main_adelas values for percentile filtering
        const allElasValues = allBrands.map(b => DASHBOARD_DATA[b].main_adelas);
        const sortedElas = [...allElasValues].sort((a, b) => a - b);
        p05Global = sortedElas[Math.floor(sortedElas.length * 0.05)];
        p95Global = sortedElas[Math.ceil(sortedElas.length * 0.95) - 1];

        // Render overall brand distribution chart
        renderOverallBrandDist(allBrands, p05Global, p95Global);

        // Populate brand selector with ALL brands
        // Mark outlier brands with ⚠ prefix
        allBrands.forEach(brand => {
            const opt = document.createElement('option');
            opt.value = brand;
            const v = DASHBOARD_DATA[brand].main_adelas;
            const isOutlier = v < p05Global || v > p95Global;
            opt.textContent = isOutlier ? `⚠ ${brand}` : brand;
            brandSelect.appendChild(opt);
        });

        brandSelect.value = allBrands[0];
        brandSelect.addEventListener('change', () => selectBrand(brandSelect.value));
        dmaSelect.addEventListener('change', () => selectDMA(dmaSelect.value));
        selectBrand(allBrands[0]);
    }

    // ---- Overall brand distribution chart (trimmed to 5th–95th percentile) ----
    function renderOverallBrandDist(allBrands, p05, p95) {
        const rawValues = allBrands.map(b => DASHBOARD_DATA[b].main_adelas);
        const values = rawValues.filter(v => v >= p05 && v <= p95);

        const bins = buildHistogramFixed(values, p05, p95, 30);

        if (charts.overallBrandDist) charts.overallBrandDist.destroy();
        charts.overallBrandDist = new Chart(document.getElementById('overall-brand-dist-chart'), {
            type: 'bar',
            data: {
                labels: bins.labels,
                datasets: [{
                    data: bins.counts,
                    backgroundColor: COLORS.blueAlpha,
                    borderColor: COLORS.blue,
                    borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: {
                        title: { display: true, text: 'Ad Elasticity (point estimate)', color: '#9ca3b8' },
                        ticks: { maxTicksLimit: 10, font: { size: 10 } },
                        grid: { color: COLORS.white12 }
                    },
                    y: {
                        title: { display: true, text: 'Number of Brands', color: '#9ca3b8' },
                        grid: { color: COLORS.white12 }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: ctx => `Elasticity: ${ctx[0].label}`,
                            label: ctx => `${ctx.raw} brands`
                        }
                    }
                }
            }
        });
    }

    // ---- Histogram with fixed min/max ----
    function buildHistogramFixed(values, min, max, numBins) {
        const range = max - min;
        const binWidth = range / numBins;
        const counts = new Array(numBins).fill(0);
        const edges = [];
        for (let i = 0; i <= numBins; i++) edges.push(min + i * binWidth);
        for (const v of values) {
            if (v < min || v > max) continue;
            let idx = Math.floor((v - min) / binWidth);
            if (idx >= numBins) idx = numBins - 1;
            counts[idx]++;
        }
        const labels = counts.map((_, i) => (min + i * binWidth).toFixed(2));
        return { labels, counts, edges };
    }

    // ---- Select brand ----
    function selectBrand(brand) {
        currentBrand = brand;
        const data = DASHBOARD_DATA[brand];
        if (!data) return;

        // Check if brand is an outlier
        const isOutlier = data.main_adelas < p05Global || data.main_adelas > p95Global;
        const banner = document.getElementById('limited-data-banner');
        banner.style.display = isOutlier ? 'block' : 'none';

        const nTotal = data.dmas.length;
        const nLimited = data.dmas.filter(d => d.limited).length;
        const metaParts = [`${nTotal} DMAs`, `${data.all_elas.length.toLocaleString()} stores`];
        if (nLimited > 0) {
            metaParts.push(`${nLimited} with limited data`);
        }
        brandMeta.textContent = metaParts.join(' · ');

        kpiValue.textContent = data.main_adelas.toFixed(3);

        renderModerators(data);
        renderStoreDistribution(data);
        renderDMABoxplot(data);
        populateDMASelect(data);
        selectDMA(dmaSelect.value);
    }

    // ---- Moderators bar chart ----
    function renderModerators(data) {
        const mods = [...data.moderators].sort((a, b) => a.value - b.value);
        const labels = mods.map(m => m.label);
        const values = mods.map(m => m.value);
        const barColors = values.map(v => v >= 0 ? COLORS.blueAlpha : COLORS.indigoAlpha);

        if (charts.moderators) charts.moderators.destroy();
        charts.moderators = new Chart(document.getElementById('moderators-chart'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: barColors,
                    borderColor: barColors.map(c => c.replace('0.75', '1').replace('0.7', '1')),
                    borderWidth: 1, borderRadius: 4, barPercentage: 0.7,
                }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { display: false, grid: { color: COLORS.white12 } },
                    y: { grid: { display: false }, ticks: { font: { size: 11 } } }
                },
                plugins: {
                    tooltip: { callbacks: { label: ctx => (ctx.raw * 100).toFixed(1) + '% of main effect' } }
                }
            }
        });
    }

    // ---- Store distribution histogram ----
    function renderStoreDistribution(data) {
        const bins = buildHistogram(data.all_elas, 60);
        const total = bins.counts.reduce((a, b) => a + b, 0);
        const proportions = bins.counts.map(c => total > 0 ? c / total : 0);
        if (charts.storeDist) charts.storeDist.destroy();
        charts.storeDist = new Chart(document.getElementById('store-dist-chart'), {
            type: 'bar',
            data: {
                labels: bins.labels,
                datasets: [{
                    data: proportions,
                    backgroundColor: COLORS.blueFaint, borderColor: COLORS.blue,
                    borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: 'Ad Elasticity', color: '#9ca3b8' }, ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { color: COLORS.white12 } },
                    y: { title: { display: true, text: 'Proportion', color: '#9ca3b8' }, grid: { color: COLORS.white12 }, ticks: { callback: v => (v * 100).toFixed(0) + '%' } }
                },
                plugins: {
                    tooltip: { callbacks: { title: ctx => `Elasticity: ${ctx[0].label}`, label: ctx => `${(ctx.raw * 100).toFixed(1)}%` } }
                }
            }
        });
    }

    // ---- DMA Boxplot (custom canvas) ----
    function renderDMABoxplot(data) {
        const canvas = document.getElementById('dma-boxplot-chart');
        const section = document.getElementById('dma-boxplot-section');

        const existingMsg = section.querySelector('.insufficient-data-msg');
        if (existingMsg) existingMsg.remove();

        // Use ALL DMAs for the boxplot distribution
        const allDMAs = data.dmas;

        if (allDMAs.length < 10) {
            if (charts.dmaBoxplot) { charts.dmaBoxplot.destroy(); charts.dmaBoxplot = null; }
            canvas.style.display = 'none';
            const msg = document.createElement('div');
            msg.className = 'insufficient-data-msg';
            msg.textContent = 'Distribution across DMAs is not available for this brand due to a limited number of DMAs (fewer than 10).';
            canvas.parentElement.appendChild(msg);
            return;
        }

        if (charts.dmaBoxplot) { charts.dmaBoxplot.destroy(); charts.dmaBoxplot = null; }
        canvas.style.display = '';

        const dmas = allDMAs.slice(0, 80);
        const dpr = window.devicePixelRatio || 1;
        const displayW = canvas.clientWidth || 800;
        const displayH = 350;
        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
        canvas.style.height = displayH + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const W = displayW, H = displayH;
        const padL = 55, padR = 15, padT = 35, padB = 35;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        // Y range
        const allVals = dmas.flatMap(d => [d.min, d.max]);
        let yMin = Math.min(...allVals), yMax = Math.max(...allVals);
        const yPad = (yMax - yMin) * 0.1;
        yMin -= yPad; yMax += yPad;

        function yToPixel(val) {
            return padT + plotH * (1 - (val - yMin) / (yMax - yMin));
        }

        ctx.clearRect(0, 0, W, H);

        // Y grid & labels
        const nTicks = 8;
        const rawStep = (yMax - yMin) / nTicks;
        const yStep = parseFloat(rawStep.toPrecision(1));
        const yStart = Math.floor(yMin / yStep) * yStep;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = "10px 'Inter', sans-serif";
        for (let val = yStart; val <= yMax + yStep; val += yStep) {
            const py = yToPixel(val);
            if (py < padT - 5 || py > H - padB + 5) continue;
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke();
            ctx.fillStyle = '#9ca3b8';
            ctx.fillText(val.toFixed(2), padL - 6, py);
        }

        // Axis labels
        ctx.save();
        ctx.translate(12, padT + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.font = "11px 'Inter', sans-serif";
        ctx.fillStyle = '#9ca3b8';
        ctx.fillText('Ad Elasticity', 0, 0);
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.font = "11px 'Inter', sans-serif";
        ctx.fillStyle = '#9ca3b8';
        ctx.fillText('DMA (ordered by median elasticity)', padL + plotW / 2, H - 5);

        // Draw each boxplot
        const slotW = plotW / dmas.length;
        dmas.forEach((d, i) => {
            const cx = padL + (i + 0.5) * slotW;
            const iqr = d.q3 - d.q1;
            const wLo = Math.max(d.min, d.q1 - 1.5 * iqr);
            const wHi = Math.min(d.max, d.q3 + 1.5 * iqr);
            const boxW = Math.max(slotW * 0.55, 3);
            const capW = Math.max(slotW * 0.2, 2);

            // Whisker line
            ctx.strokeStyle = 'rgba(156,163,184,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, yToPixel(wLo));
            ctx.lineTo(cx, yToPixel(wHi));
            ctx.stroke();
            // Caps
            ctx.beginPath();
            ctx.moveTo(cx - capW, yToPixel(wLo)); ctx.lineTo(cx + capW, yToPixel(wLo));
            ctx.moveTo(cx - capW, yToPixel(wHi)); ctx.lineTo(cx + capW, yToPixel(wHi));
            ctx.stroke();

            // IQR box
            const q1y = yToPixel(d.q1), q3y = yToPixel(d.q3);
            ctx.fillStyle = 'rgba(96,165,250,0.25)';
            ctx.fillRect(cx - boxW / 2, q3y, boxW, q1y - q3y);
            ctx.strokeStyle = 'rgba(96,165,250,0.7)';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx - boxW / 2, q3y, boxW, q1y - q3y);

            // Median line
            const my = yToPixel(d.median);
            ctx.strokeStyle = COLORS.cyan;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - boxW / 2, my);
            ctx.lineTo(cx + boxW / 2, my);
            ctx.stroke();
        });

        // Legend
        ctx.font = "11px 'Inter', sans-serif";
        const lx = padL + plotW / 2 - 100, ly = 14;
        ctx.strokeStyle = 'rgba(156,163,184,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 15, ly); ctx.stroke();
        ctx.fillStyle = '#9ca3b8'; ctx.textAlign = 'left';
        ctx.fillText('Whiskers', lx + 20, ly + 4);
        ctx.fillStyle = 'rgba(96,165,250,0.25)';
        ctx.fillRect(lx + 85, ly - 5, 12, 10);
        ctx.strokeStyle = 'rgba(96,165,250,0.7)';
        ctx.strokeRect(lx + 85, ly - 5, 12, 10);
        ctx.fillStyle = '#9ca3b8';
        ctx.fillText('IQR', lx + 102, ly + 4);
        ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lx + 135, ly); ctx.lineTo(lx + 150, ly); ctx.stroke();
        ctx.fillStyle = '#9ca3b8';
        ctx.fillText('Median', lx + 155, ly + 4);
    }

    // ---- DMA Dropdown (only DMAs with ≥10 obs) ----
    function populateDMASelect(data) {
        dmaSelect.innerHTML = '';
        const eligible = data.dmas.filter(d => !d.limited);
        if (eligible.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No DMAs with sufficient data';
            dmaSelect.appendChild(opt);
            return;
        }
        const sorted = [...eligible].sort((a, b) => b.median - a.median);
        sorted.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.dma;
            opt.textContent = `DMA ${d.dma} (median: ${d.median.toFixed(3)}, ${d.n_stores} stores)`;
            dmaSelect.appendChild(opt);
        });
    }

    // ---- DMA Selection ----
    function selectDMA(dmaCode) {
        const data = DASHBOARD_DATA[currentBrand];
        if (!data) return;

        const dma = data.dmas.find(d => d.dma === dmaCode);

        // Remove any previous DMA limited-data message
        const existingMsg = document.getElementById('dma-drilldown-section').querySelector('.insufficient-data-msg');
        if (existingMsg) existingMsg.remove();

        if (!dma) {
            document.getElementById('dma-td-brand').textContent = currentBrand;
            document.getElementById('dma-td-code').textContent = '—';
            document.getElementById('dma-td-stores').textContent = '—';
            document.getElementById('dma-td-adstock').textContent = '—';
            document.getElementById('dma-td-median').textContent = '—';
            if (charts.dmaHist) { charts.dmaHist.destroy(); charts.dmaHist = null; }
            renderDMAMap(null, data.dmas);
            return;
        }

        // Update table
        document.getElementById('dma-td-brand').textContent = currentBrand;
        document.getElementById('dma-td-code').textContent = dma.dma;
        document.getElementById('dma-td-stores').textContent = dma.n_stores;
        document.getElementById('dma-td-adstock').textContent = (dma.mean_adstock * 100).toFixed(2);
        document.getElementById('dma-td-median').textContent = dma.median.toFixed(3);

        renderDMAMap(dma, data.dmas);

        const histCanvas = document.getElementById('dma-hist-chart');
        if (dma.limited) {
            // Hide histogram, show warning
            if (charts.dmaHist) { charts.dmaHist.destroy(); charts.dmaHist = null; }
            histCanvas.style.display = 'none';
            const msg = document.createElement('div');
            msg.className = 'insufficient-data-msg';
            msg.textContent = `This DMA has limited data (${dma.n_obs} observations). Within-DMA distribution is not shown.`;
            histCanvas.parentElement.appendChild(msg);
        } else {
            histCanvas.style.display = '';
            renderDMAHistogram(dma);
        }
    }

    // ---- Dynamic DMA Map ----
    function renderDMAMap(selectedDMA, allDMAs) {
        const canvas = mapCanvas;
        const dpr = window.devicePixelRatio || 1;
        const displayW = canvas.clientWidth || 600;
        const displayH = Math.round(displayW * 0.62);

        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
        canvas.style.height = displayH + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const W = displayW;
        const H = displayH;

        // Background
        ctx.fillStyle = '#141726';
        ctx.fillRect(0, 0, W, H);

        // Map projection (simple equirectangular)
        const pad = 30;
        function project(lat, lon) {
            const x = pad + ((lon - US_BOUNDS.minLon) / (US_BOUNDS.maxLon - US_BOUNDS.minLon)) * (W - 2 * pad);
            const y = pad + ((US_BOUNDS.maxLat - lat) / (US_BOUNDS.maxLat - US_BOUNDS.minLat)) * (H - 2 * pad);
            return [x, y];
        }

        // Draw simplified US outline
        drawUSOutline(ctx, project);

        // Draw all DMA dots
        allDMAs.forEach(d => {
            if (!d.lat || !d.lon) return;
            const [x, y] = project(d.lat, d.lon);
            const isSelected = selectedDMA && d.dma === selectedDMA.dma;

            if (!isSelected) {
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(96,165,250,0.3)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(96,165,250,0.5)';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        });

        // Draw selected DMA (on top)
        if (selectedDMA && selectedDMA.lat && selectedDMA.lon) {
            const [x, y] = project(selectedDMA.lat, selectedDMA.lon);

            // Glow
            const glow = ctx.createRadialGradient(x, y, 0, x, y, 20);
            glow.addColorStop(0, 'rgba(239,68,68,0.4)');
            glow.addColorStop(1, 'rgba(239,68,68,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(x - 20, y - 20, 40, 40);

            // Dot
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ef4444';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#e8eaf0';
            ctx.font = "600 11px 'Inter', sans-serif";
            ctx.textAlign = 'left';
            ctx.fillText(`DMA ${selectedDMA.dma}`, x + 12, y + 4);
        }

        // Title
        ctx.fillStyle = '#e8eaf0';
        ctx.font = "600 14px 'Inter', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText('Selected DMA', W / 2, 20);
    }

    // ---- Draw all US state borders ----
    function drawUSOutline(ctx, project) {
        if (!window.US_STATES) return;

        // Draw state fills first
        window.US_STATES.forEach((statePolys, si) => {
            statePolys.forEach((ring, ri) => {
                if (ring.length < 3) return;
                ctx.beginPath();
                const [sx, sy] = project(ring[0][1], ring[0][0]);
                ctx.moveTo(sx, sy);
                for (let i = 1; i < ring.length; i++) {
                    const [px, py] = project(ring[i][1], ring[i][0]);
                    ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fillStyle = 'rgba(100,150,200,0.06)';
                ctx.fill();
            });
        });

        // Draw state borders on top
        ctx.strokeStyle = 'rgba(200,220,255,0.35)';
        ctx.lineWidth = 1;
        window.US_STATES.forEach(statePolys => {
            statePolys.forEach(ring => {
                if (ring.length < 3) return;
                ctx.beginPath();
                const [sx, sy] = project(ring[0][1], ring[0][0]);
                ctx.moveTo(sx, sy);
                for (let i = 1; i < ring.length; i++) {
                    const [px, py] = project(ring[i][1], ring[i][0]);
                    ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.stroke();
            });
        });
    }

    // ---- DMA Histogram ----
    function renderDMAHistogram(dma) {
        const values = dma.store_elas;
        const numBins = Math.min(Math.max(10, Math.ceil(Math.sqrt(values.length))), 40);
        const bins = buildHistogram(values, numBins);
        const total = bins.counts.reduce((a, b) => a + b, 0);
        const proportions = bins.counts.map(c => total > 0 ? c / total : 0);
        const medianVal = dma.median;

        if (charts.dmaHist) charts.dmaHist.destroy();
        charts.dmaHist = new Chart(document.getElementById('dma-hist-chart'), {
            type: 'bar',
            data: {
                labels: bins.labels,
                datasets: [{
                    data: proportions,
                    backgroundColor: COLORS.blueAlpha, borderColor: COLORS.blue,
                    borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    title: { display: true, text: 'Distribution of Ad Elasticity Within Selected DMA', color: '#e8eaf0', font: { size: 14, weight: 600 } },
                    subtitle: { display: true, text: `Dashed line indicates median store-level elasticity (${medianVal.toFixed(3)})`, color: '#9ca3b8', font: { size: 11 }, padding: { bottom: 12 } },
                    tooltip: { callbacks: { title: ctx => `Elasticity: ${ctx[0].label}`, label: ctx => `${(ctx.raw * 100).toFixed(1)}%` } }
                },
                scales: {
                    x: { title: { display: true, text: 'Ad Elasticity', color: '#9ca3b8' }, ticks: { maxTicksLimit: 8, font: { size: 10 } }, grid: { color: COLORS.white12 } },
                    y: { title: { display: true, text: 'Proportion', color: '#9ca3b8' }, grid: { color: COLORS.white12 }, ticks: { callback: v => (v * 100).toFixed(0) + '%' } }
                }
            },
            plugins: [{
                id: 'medianLine',
                afterDraw(chart) {
                    const xScale = chart.scales.x;
                    const yScale = chart.scales.y;
                    const ctx = chart.ctx;
                    const binIdx = bins.edges.findIndex((e, i) =>
                        i < bins.edges.length - 1 && medianVal >= e && medianVal < bins.edges[i + 1]
                    );
                    if (binIdx < 0) return;
                    const binWidth = (xScale.right - xScale.left) / bins.counts.length;
                    const binLeft = xScale.left + binIdx * binWidth;
                    const frac = (medianVal - bins.edges[binIdx]) / (bins.edges[binIdx + 1] - bins.edges[binIdx]);
                    const xPos = binLeft + frac * binWidth;
                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash([6, 4]);
                    ctx.strokeStyle = COLORS.grayLine;
                    ctx.lineWidth = 2;
                    ctx.moveTo(xPos, yScale.top);
                    ctx.lineTo(xPos, yScale.bottom);
                    ctx.stroke();
                    ctx.restore();
                }
            }]
        });
    }

    // ---- Histogram utility ----
    function buildHistogram(values, numBins) {
        if (!values.length) return { labels: [], counts: [], edges: [] };
        const sorted = [...values].sort((a, b) => a - b);
        const p01 = sorted[Math.floor(sorted.length * 0.01)];
        const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
        const min = p01, max = p99;
        const range = max - min || 1;
        const binWidth = range / numBins;
        const counts = new Array(numBins).fill(0);
        const edges = [];
        for (let i = 0; i <= numBins; i++) edges.push(min + i * binWidth);
        for (const v of values) {
            if (v < min || v > max) continue;
            let idx = Math.floor((v - min) / binWidth);
            if (idx >= numBins) idx = numBins - 1;
            counts[idx]++;
        }
        const labels = counts.map((_, i) => (min + i * binWidth).toFixed(2));
        return { labels, counts, edges };
    }

    function computeYMin(dmas) {
        const vals = dmas.map(d => Math.max(d.min, d.q1 - 1.5 * (d.q3 - d.q1)));
        return Math.floor(Math.min(...vals) * 2) / 2;
    }
    function computeYMax(dmas) {
        const vals = dmas.map(d => Math.min(d.max, d.q3 + 1.5 * (d.q3 - d.q1)));
        return Math.ceil(Math.max(...vals) * 2) / 2;
    }

    init();
})();
