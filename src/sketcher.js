/**
 * SiteSketcher – ArcSite-inspired professional drawing tool
 *
 * Coordinate system:
 *   • All shape data stored in **world units (metres)**
 *   • basePPM  = pixels per metre at zoom = 1  (set by scale selector)
 *   • w2s(x,y) → screen px     s2w(sx,sy) → world metres
 */

export class SiteSketcher {
  // ─────────────────────────────────────────────────────────────────────────
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.W = 900; this.H = 560;
    this.canvas.width  = this.W;
    this.canvas.height = this.H;

    // ── viewport ──
    this.zoom   = 1;
    this.panX   = 40;   // screen-px offset
    this.panY   = 40;
    this.basePPM = 50;  // pixels per metre at zoom=1  (1:100 default)
    this.MIN_ZOOM = 0.1;
    this.MAX_ZOOM = 20;

    // ── grid / snap ──
    this.gridSize  = 0.5;   // metres
    this.snapGrid  = true;
    this.snapEndpt = true;
    this.SNAP_PX   = 14;    // screen pixels for endpoint snap radius

    // ── shapes & state ──
    this.shapes        = [];
    this.mode          = 'select';
    this.selectedShape = null;
    this.selectedHandle= null;
    this.isDown        = false;
    this.isPanning     = false;
    this.lastSP        = {x:0,y:0};   // last screen pos (for pan)
    this.dragStart     = {x:0,y:0};   // world pos at mousedown
    this.shapeOffset   = {x:0,y:0};
    this.wallChain     = [];           // wall-tool in-progress points
    this.polyChain     = [];           // polybuilding / room in-progress
    this.previewPt     = null;         // current cursor world pos
    this.shiftDown     = false;
    this.spaceDown     = false;

    // ── map bg ──
    this.mapBgImage      = null;
    this.mapBgLoaded     = false;
    this.mapLat = this.mapLon = 0;
    this.mapZoom = 17;
    this.mapType = 'satellite';

    // ── history ──
    this.history = [];
    this.future  = [];
    this.isExporting = false;
    this.showA4Frame = false;

    // ── callbacks (set externally) ──
    this.onSelectionChange = null;
    this.onHistoryChange   = null;
    this.onPolyNodeAdded   = null;
    this.onZoomChange      = null;

    this._initEvents();
    this.draw();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  TRANSFORMS
  // ═══════════════════════════════════════════════════════════════════════
  get ppm() { return this.basePPM * this.zoom; }

  w2s(wx, wy) {
    return { x: wx * this.ppm + this.panX,
             y: wy * this.ppm + this.panY };
  }
  s2w(sx, sy) {
    return { x: (sx - this.panX) / this.ppm,
             y: (sy - this.panY) / this.ppm };
  }

  // ─── snap raw world point ───
  _snap(raw, excludeId) {
    let pt = { ...raw };

    // grid snap
    if (this.snapGrid) {
      const g = this.gridSize;
      pt.x = Math.round(pt.x / g) * g;
      pt.y = Math.round(pt.y / g) * g;
    }

    // endpoint snap (overrides grid if closer)
    if (this.snapEndpt) {
      const thrW = this.SNAP_PX / this.ppm;
      let best = null, bestDist = thrW;
      this._allEndpoints(excludeId).forEach(ep => {
        const d = Math.hypot(raw.x - ep.x, raw.y - ep.y);
        if (d < bestDist) { bestDist = d; best = ep; }
      });
      if (best) pt = best;
    }
    return pt;
  }

  // collect all snapable endpoints from shapes
  _allEndpoints(excludeId) {
    const pts = [];
    this.shapes.forEach(s => {
      if (s.id === excludeId) return;
      if (s.x1 !== undefined) { pts.push({x:s.x1,y:s.y1}); pts.push({x:s.x2,y:s.y2}); }
      if (s.type === 'building' || s.type === 'custom-block') {
        pts.push({x:s.x,y:s.y},{x:s.x+s.w,y:s.y},{x:s.x+s.w,y:s.y+s.h},{x:s.x,y:s.y+s.h});
      }
      if (s.points) s.points.forEach(p => pts.push({x:p.x,y:p.y}));
    });
    // include in-progress wall chain
    this.wallChain.forEach(p => pts.push(p));
    this.polyChain.forEach(p => pts.push(p));
    return pts;
  }

  // constrain angle to 0/45/90
  _constrain(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
    const snap  = Math.PI / 4;
    const a2    = Math.round(angle / snap) * snap;
    const len   = Math.hypot(dx, dy);
    return { x: from.x + Math.cos(a2)*len, y: from.y + Math.sin(a2)*len };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  HISTORY
  // ═══════════════════════════════════════════════════════════════════════
  pushHistory() {
    this.history.push(JSON.stringify(this.shapes));
    if (this.history.length > 80) this.history.shift();
    this.future = [];
    if (this.onHistoryChange) this.onHistoryChange(this.history.length, 0);
  }
  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.shapes));
    this.shapes = JSON.parse(this.history.pop());
    this.selectedShape = null; this.draw();
    if (this.onSelectionChange) this.onSelectionChange(null);
    if (this.onHistoryChange)   this.onHistoryChange(this.history.length, this.future.length);
  }
  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.shapes));
    this.shapes = JSON.parse(this.future.pop());
    this.selectedShape = null; this.draw();
    if (this.onSelectionChange) this.onSelectionChange(null);
    if (this.onHistoryChange)   this.onHistoryChange(this.history.length, this.future.length);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  _initEvents() {
    const getSP = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x:(cx-r.left)*(this.W/r.width), y:(cy-r.top)*(this.H/r.height) };
    };

    // ── wheel zoom ──
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const sp = getSP(e);
      const wp = this.s2w(sp.x, sp.y);
      const f  = e.deltaY < 0 ? 1.12 : 1/1.12;
      this.zoom = Math.min(this.MAX_ZOOM, Math.max(this.MIN_ZOOM, this.zoom * f));
      this.panX = sp.x - wp.x * this.ppm;
      this.panY = sp.y - wp.y * this.ppm;
      if (this.onZoomChange) this.onZoomChange(this.zoom);
      this.draw();
    }, { passive:false });

    // ── mouse down ──
    const onDown = (e) => {
      if (e.button === 2) return; // ignore right click
      const sp  = getSP(e);
      const raw = this.s2w(sp.x, sp.y);

      // pan: middle button or Space held
      if (e.button === 1 || this.spaceDown) {
        this.isPanning = true; this.lastSP = sp; return;
      }

      e.preventDefault();
      this.isDown = true;
      this.dragStart = raw;

      switch (this.mode) {

        case 'select': {
          if (this.selectedShape) {
            const h = this._checkHandle(raw, this.selectedShape);
            if (h) { this.selectedHandle = h; return; }
          }
          const hit = this._hitTest(raw);
          this.selectedShape = hit;
          if (hit) this.shapeOffset = { x: raw.x-(hit.x||0), y: raw.y-(hit.y||0) };
          if (this.onSelectionChange) this.onSelectionChange(hit);
          this.draw(); break;
        }

        case 'wall': {
          const pt = this._snap(raw, null);
          if (this.wallChain.length === 0) {
            this.wallChain.push({...pt});
          } else {
            // close if click near start
            const start = this.wallChain[0];
            const distToStart = Math.hypot(pt.x-start.x, pt.y-start.y) * this.ppm;
            if (distToStart < this.SNAP_PX && this.wallChain.length >= 3) {
              this._commitWallChain(true);
            } else {
              this.wallChain.push({...pt});
            }
          }
          this.draw(); break;
        }

        case 'room':
        case 'polybuilding': {
          const pt = this._snap(raw, null);
          if (this.polyChain.length === 0) {
            this.polyChain = [{...pt}];
          } else {
            const start = this.polyChain[0];
            if (Math.hypot(pt.x-start.x, pt.y-start.y)*this.ppm < this.SNAP_PX && this.polyChain.length >= 3) {
              this._commitPolyChain();
            } else {
              this.polyChain.push({...pt});
            }
          }
          if (this.onPolyNodeAdded) this.onPolyNodeAdded(this.polyChain.length);
          this.draw(); break;
        }

        case 'boundary-wall':
        case 'gate':
        case 'gate-toran':
        case 'dimension':
        case 'line': {
          const pt = this._snap(raw, null);
          this.wallChain = [{...pt}];
          this.draw(); break;
        }

        case 'building': {
          this.pushHistory();
          const pt = this._snap(raw, null);
          const nb = { id:Date.now(), type:'building', x:pt.x, y:pt.y, w:6, h:4,
                       label:'Building Block', structureType:'rcc',
                       dimW:'6.00m', dimH:'4.00m', dimWOffset:-1.5, dimHOffset:-1.5 };
          this.shapes.push(nb); this.selectedShape = nb; this.mode = 'select';
          if (this.onSelectionChange) this.onSelectionChange(nb);
          this.draw(); break;
        }

        case 'custom-block': {
          this.pushHistory();
          const pt = this._snap(raw, null);
          const nb = { id:Date.now(), type:'custom-block', x:pt.x, y:pt.y, w:4, h:3,
                       label:'Misc', blockStyle:'misc', dimWOffset:-1.5, dimHOffset:-1.5 };
          this.shapes.push(nb); this.selectedShape = nb; this.mode = 'select';
          if (this.onSelectionChange) this.onSelectionChange(nb);
          this.draw(); break;
        }

        case 'road': {
          this.pushHistory();
          const pt = this._snap(raw, null);
          let label = 'NH-37';
          let leftLabel = 'KALIABAR';
          let rightLabel = 'NUMALIGARH';
          if (typeof window !== 'undefined' && window.getActiveProjectRoute) {
            const route = window.getActiveProjectRoute();
            if (route) {
              label = route.road;
              leftLabel = route.left;
              rightLabel = route.right;
            }
          }
          const nr = { id:Date.now(), type:'road', y:pt.y-1.5, h:3,
                       label, leftLabel, rightLabel };
          this.shapes.push(nr); this.selectedShape = nr; this.mode = 'select';
          if (this.onSelectionChange) this.onSelectionChange(nr);
          this.draw(); break;
        }

        case 'text': {
          this.pushHistory();
          const pt = this._snap(raw, null);
          const nt = { id:Date.now(), type:'text', x:pt.x, y:pt.y, text:'Label' };
          this.shapes.push(nt); this.selectedShape = nt; this.mode = 'select';
          if (this.onSelectionChange) this.onSelectionChange(nt);
          this.draw(); break;
        }

        case 'freehand': {
          this.wallChain = [{...raw}];
          break;
        }

        case 'erase': {
          const hit = this._hitTest(raw);
          if (hit) {
            this.pushHistory();
            this.shapes = this.shapes.filter(s => s.id !== hit.id);
            if (this.selectedShape?.id === hit.id) { this.selectedShape = null; if (this.onSelectionChange) this.onSelectionChange(null); }
          }
          this.draw(); break;
        }
      }
    };

    // ── mouse move ──
    const onMove = (e) => {
      const sp  = getSP(e);

      // pan
      if (this.isPanning) {
        this.panX += sp.x - this.lastSP.x;
        this.panY += sp.y - this.lastSP.y;
        this.lastSP = sp;
        this.draw(); return;
      }

      const raw = this.s2w(sp.x, sp.y);
      let pt = this._snap(raw, this.selectedShape?.id);
      if (this.shiftDown && this.wallChain.length > 0) {
        pt = this._constrain(this.wallChain[this.wallChain.length-1], pt);
      }
      this.previewPt = pt;

      if (!this.isDown) { this.draw(); return; }
      e.preventDefault();

      if (this.mode === 'select' && this.selectedShape) {
        const s = this.selectedShape;
        const h = this.selectedHandle;

        if (h === 'dim-w') { s.dimWOffset = (s.dimWOffset||(-1.5)) + (raw.y - this.dragStart.y); this.dragStart=raw; this.draw(); return; }
        if (h === 'dim-h') { s.dimHOffset = (s.dimHOffset||(-1.5)) + (raw.x - this.dragStart.x); this.dragStart=raw; this.draw(); return; }
        if (h === 'dim-line') {
          const dx=s.x2-s.x1,dy=s.y2-s.y1,l=Math.hypot(dx,dy)||1;
          const nx=-dy/l,ny=dx/l;
          s.dimOffset = (s.dimOffset||(-1)) + (raw.x-this.dragStart.x)*nx + (raw.y-this.dragStart.y)*ny;
          this.dragStart=raw; this.draw(); return;
        }

        if (h === 'ep1') { s.x1=pt.x; s.y1=pt.y; this._updateLineDim(s); this.draw(); return; }
        if (h === 'ep2') { s.x2=pt.x; s.y2=pt.y; this._updateLineDim(s); this.draw(); return; }

        if (h && (s.type==='building'||s.type==='custom-block')) {
          const minW=0.5, minH=0.3;
          if      (h==='se') { s.w=Math.max(minW,pt.x-s.x); s.h=Math.max(minH,pt.y-s.y); }
          else if (h==='sw') { const dX=pt.x-s.x; s.x=pt.x; s.w=Math.max(minW,s.w-dX); s.h=Math.max(minH,pt.y-s.y); }
          else if (h==='ne') { const dY=pt.y-s.y; s.y=pt.y; s.w=Math.max(minW,pt.x-s.x); s.h=Math.max(minH,s.h-dY); }
          else if (h==='nw') { const dX=pt.x-s.x,dY=pt.y-s.y; s.x=pt.x;s.y=pt.y; s.w=Math.max(minW,s.w-dX);s.h=Math.max(minH,s.h-dY); }
          s.dimW=`${s.w.toFixed(2)}m`; s.dimH=`${s.h.toFixed(2)}m`;
          this.draw(); return;
        }

        if (!h) {
          const dx=raw.x-this.dragStart.x, dy=raw.y-this.dragStart.y;
          if (s.type==='building'||s.type==='text'||s.type==='custom-block') { s.x=raw.x-this.shapeOffset.x; s.y=raw.y-this.shapeOffset.y; }
          else if (s.type==='road') { s.y=raw.y-this.shapeOffset.y; }
          else if (this._isLinear(s)) { s.x1+=dx;s.y1+=dy;s.x2+=dx;s.y2+=dy; this.dragStart=raw; }
          else if (s.points) { s.points.forEach(p=>{p.x+=dx;p.y+=dy;}); this.dragStart=raw; }
          this.draw();
        }

      } else if (this.mode==='freehand' && this.isDown) {
        this.wallChain.push({...raw});
        this.draw();

      } else if ((this._isLinearMode()||this.mode==='wall'||this.mode==='dimension') && this.wallChain.length===1) {
        this.draw(); // preview updates via previewPt
      }
    };

    // ── mouse up ──
    const onUp = (e) => {
      if (this.isPanning) { this.isPanning=false; return; }
      if (!this.isDown) return;
      this.isDown = false;
      this.selectedHandle = null;

      const raw = this.previewPt || this.s2w(...[0,0]);

      if ((this.mode==='boundary-wall'||this.mode==='gate'||this.mode==='gate-toran'||this.mode==='line'||this.mode==='dimension') && this.wallChain.length===1) {
        const p1 = this.wallChain[0];
        let p2 = this._snap(raw, null);
        if (this.shiftDown) p2 = this._constrain(p1, p2);
        const len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
        if (len > 0.05) {
          this.pushHistory();
          const id = Date.now();
          if (this.mode==='boundary-wall')
            this.shapes.push({ id, type:'boundary-wall', x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y, label:'Boundary Wall', dimLabel:`${len.toFixed(2)}m`, dimOffset:-1 });
          else if (this.mode==='gate')
            this.shapes.push({ id, type:'gate', x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y, label:'GATE', dimLabel:`${len.toFixed(2)}m`, dimOffset:-1 });
          else if (this.mode==='gate-toran')
            this.shapes.push({ id, type:'gate-toran', x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y, label:'GATE WITH TORAN', dimLabel:`${len.toFixed(2)}m`, dimOffset:-1 });
          else if (this.mode==='line')
            this.shapes.push({ id, type:'line', x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y, style:'dashed', label:'ROW' });
          else if (this.mode==='dimension')
            this.shapes.push({ id, type:'dimension', x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y, dimOffset:-1, manualLabel:'', label:`${len.toFixed(2)}m` });
        }
        this.wallChain=[];
        this.draw();

      } else if (this.mode==='freehand' && this.wallChain.length > 2) {
        this.pushHistory();
        this.shapes.push({ id:Date.now(), type:'freehand', points:[...this.wallChain] });
        this.wallChain=[];
        this.draw();
      }
    };

    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    this.canvas.addEventListener('mouseup', onUp);
    this.canvas.addEventListener('touchstart', onDown, {passive:false});
    this.canvas.addEventListener('touchmove',  onMove, {passive:false});
    this.canvas.addEventListener('touchend',   onUp);

    this.canvas.addEventListener('dblclick', (e) => {
      if (this.mode==='wall' && this.wallChain.length >= 2) { this._commitWallChain(false); }
      else if ((this.mode==='room'||this.mode==='polybuilding') && this.polyChain.length >= 3) { this._commitPolyChain(); }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key==='Shift') this.shiftDown=true;
      if (e.key===' ')     { this.spaceDown=true; e.preventDefault(); }
      if (e.target?.tagName==='INPUT'||e.target?.tagName==='TEXTAREA') return;
      if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); this.undo(); }
      if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); this.redo(); }
      if ((e.key==='Delete'||e.key==='Backspace')&&this.selectedShape) {
        e.preventDefault(); this.pushHistory();
        this.shapes=this.shapes.filter(s=>s.id!==this.selectedShape.id);
        this.selectedShape=null; this.draw();
        if (this.onSelectionChange) this.onSelectionChange(null);
      }
      if (e.key==='Escape') { this.wallChain=[]; this.polyChain=[]; this.previewPt=null; this.draw(); }
      if (e.key==='g'||e.key==='G') { this.snapGrid=!this.snapGrid; this.draw(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key==='Shift') this.shiftDown=false;
      if (e.key===' ')     this.spaceDown=false;
    });
  }

  _isLinear(s)     { return ['boundary-wall','gate','gate-toran','line','dimension'].includes(s?.type); }
  _isLinearMode()  { return ['boundary-wall','gate','gate-toran','line','dimension'].includes(this.mode); }

  _commitWallChain(closed) {
    if (this.wallChain.length < 2) { this.wallChain=[]; return; }
    this.pushHistory();
    const pts = [...this.wallChain];
    if (closed && pts.length>=3) pts.push({...pts[0]});
    for (let i=0; i<pts.length-1; i++) {
      const p1=pts[i], p2=pts[i+1];
      const len=Math.hypot(p2.x-p1.x,p2.y-p1.y);
      if (len>0.02) this.shapes.push({ id:Date.now()+i, type:'wall', x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y, thickness:0.23, dimLabel:`${len.toFixed(2)}m`, dimOffset:-1 });
    }
    this.wallChain=[];
    this.previewPt=null;
    this.draw();
  }

  _commitPolyChain() {
    if (this.polyChain.length < 3) { this.polyChain=[]; return; }
    this.pushHistory();
    const pts = this.polyChain.map(p=>({...p}));
    // compute area
    let area=0;
    for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length;area+=pts[i].x*pts[j].y-pts[j].x*pts[i].y;}
    const areaSqm=Math.abs(area)/2;

    if (this.mode==='room') {
      const colors=['#bfdbfe','#bbf7d0','#fde68a','#fecaca','#ddd6fe','#fed7aa','#a5f3fc','#d1fae5'];
      const col=colors[this.shapes.filter(s=>s.type==='room').length%colors.length];
      this.shapes.push({ id:Date.now(), type:'room', points:pts, label:'Room', color:col, areaSqm });
    } else {
      this.shapes.push({ id:Date.now(), type:'polygon-building', points:pts, label:'Building Block', structureType:'rcc', dimW:'', dimH:'', dimWOffset:-1.5, dimHOffset:-1.5 });
    }
    this.polyChain=[];
    this.previewPt=null;
    this.draw();
  }

  _updateLineDim(s) {
    if (!s||!this._isLinear(s)) return;
    const len=Math.hypot(s.x2-s.x1,s.y2-s.y1);
    if (s.type!=='dimension') s.dimLabel=`${len.toFixed(2)}m`;
    else if (!s.manualLabel)  s.label=`${len.toFixed(2)}m`;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  HIT TESTING
  // ═══════════════════════════════════════════════════════════════════════
  _hitTest(wp) {
    const THR = 12/this.ppm;
    for (let i=this.shapes.length-1;i>=0;i--) {
      const s=this.shapes[i];
      if (s.type==='building'||s.type==='custom-block') {
        if (wp.x>=s.x&&wp.x<=s.x+s.w&&wp.y>=s.y&&wp.y<=s.y+s.h) return s;
      } else if (s.type==='road') {
        if (wp.y>=s.y&&wp.y<=s.y+s.h) return s;
      } else if (s.type==='text') {
        if (Math.abs(wp.x-s.x)<3&&Math.abs(wp.y-s.y)<0.6) return s;
      } else if (this._isLinear(s)||s.type==='wall') {
        if (this._distSeg(wp,{x:s.x1,y:s.y1},{x:s.x2,y:s.y2})<THR) return s;
      } else if (s.type==='freehand') {
        if (s.points.some(p=>Math.hypot(wp.x-p.x,wp.y-p.y)<THR)) return s;
      } else if (s.type==='room'||s.type==='polygon-building'||s.type==='polygon') {
        if (this._ptInPoly(wp,s.points)) return s;
      }
    }
    return null;
  }

  _checkHandle(wp, s) {
    if (!s) return null;
    const THR = 12/this.ppm;
    if (s.type==='building'||s.type==='custom-block') {
      const cs=[{k:'nw',x:s.x,y:s.y},{k:'ne',x:s.x+s.w,y:s.y},{k:'se',x:s.x+s.w,y:s.y+s.h},{k:'sw',x:s.x,y:s.y+s.h}];
      for(const c of cs) if(Math.hypot(wp.x-c.x,wp.y-c.y)<THR) return c.k;
      if(s.dimW&&Math.hypot(wp.x-(s.x+s.w/2),wp.y-(s.y+(s.dimWOffset||(-1.5))))<THR) return 'dim-w';
      if(s.dimH&&Math.hypot(wp.x-(s.x+(s.dimHOffset||(-1.5))),wp.y-(s.y+s.h/2))<THR) return 'dim-h';
    }
    if (this._isLinear(s)||s.type==='wall') {
      if(Math.hypot(wp.x-s.x1,wp.y-s.y1)<THR) return 'ep1';
      if(Math.hypot(wp.x-s.x2,wp.y-s.y2)<THR) return 'ep2';
      const dx=s.x2-s.x1,dy=s.y2-s.y1,l=Math.hypot(dx,dy)||1;
      const nx=-dy/l,ny=dx/l,off=s.dimOffset||(-1);
      const lx=(s.x1+s.x2)/2+nx*off,ly=(s.y1+s.y2)/2+ny*off;
      if(Math.hypot(wp.x-lx,wp.y-ly)<THR) return 'dim-line';
    }
    return null;
  }

  _distSeg(p,v,w){const l2=(v.x-w.x)**2+(v.y-w.y)**2;if(!l2)return Math.hypot(p.x-v.x,p.y-v.y);let t=((p.x-v.x)*(w.x-v.x)+(p.y-v.y)*(w.y-v.y))/l2;t=Math.max(0,Math.min(1,t));return Math.hypot(p.x-(v.x+t*(w.x-v.x)),p.y-(v.y+t*(w.y-v.y)));}
  _ptInPoly(p,pts){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;if((yi>p.y)!==(yj>p.y)&&p.x<(xj-xi)*(p.y-yi)/(yj-yi)+xi)inside=!inside;}return inside;}

  // ═══════════════════════════════════════════════════════════════════════
  //  DRAW
  // ═══════════════════════════════════════════════════════════════════════
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0,0,this.W,this.H);

    // bg
    if (this.mapBgLoaded&&this.mapBgImage) {
      ctx.drawImage(this.mapBgImage,0,0,this.W,this.H);
      ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(0,0,this.W,this.H);
    } else {
      ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,this.W,this.H);
    }

    // grid
    if (!this.isExporting) {
      this._drawGrid();
    }

    // rooms first (fills behind walls)
    this.shapes.filter(s=>s.type==='room').forEach(s=>this._drawShape(s));
    // all other shapes
    this.shapes.filter(s=>s.type!=='room').forEach(s=>this._drawShape(s));

    // in-progress preview
    if (!this.isExporting) {
      this._drawPreview();
    }

    // selection overlay
    if (this.mode==='select'&&this.selectedShape && !this.isExporting) this._drawSelection(this.selectedShape);

    // A4 frame guide
    if (this.showA4Frame && !this.isExporting) {
      this._drawA4Frame();
    }

    // status bar
    if (!this.isExporting) {
      this._drawStatus();
    }
  }

  _drawGrid() {
    const ctx=this.ctx, p=this.ppm;
    // choose grid spacing so lines are 25-120px apart
    const spacings=[0.1,0.25,0.5,1,2,5,10,20,50,100];
    let g=1; for(const s of spacings){if(s*p>=30){g=s;break;}}
    const gPx=g*p;

    ctx.save();
    // minor
    ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
    const ox=((this.panX%gPx)+gPx)%gPx, oy=((this.panY%gPx)+gPx)%gPx;
    for(let x=ox;x<this.W;x+=gPx){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,this.H);ctx.stroke();}
    for(let y=oy;y<this.H;y+=gPx){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(this.W,y);ctx.stroke();}

    // major (5×)
    const mPx=gPx*5, mG=g*5;
    ctx.strokeStyle='#cbd5e1'; ctx.lineWidth=1;
    const mox=((this.panX%mPx)+mPx)%mPx, moy=((this.panY%mPx)+mPx)%mPx;
    for(let x=mox;x<this.W;x+=mPx){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,this.H);ctx.stroke();}
    for(let y=moy;y<this.H;y+=mPx){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(this.W,y);ctx.stroke();}

    // axis labels
    ctx.fillStyle='#94a3b8'; ctx.font='9px sans-serif'; ctx.textBaseline='top';
    const startWX=Math.ceil(this.s2w(0,0).x/mG)*mG;
    for(let wx=startWX;this.w2s(wx,0).x<this.W;wx+=mG){
      const sx=this.w2s(wx,0).x;
      ctx.fillText(`${(wx).toFixed(mG<1?1:0)}m`,sx+2,this.H-14);
    }
    ctx.textBaseline='middle'; ctx.textAlign='right';
    const startWY=Math.ceil(this.s2w(0,0).y/mG)*mG;
    for(let wy=startWY;this.w2s(0,wy).y<this.H;wy+=mG){
      const sy=this.w2s(0,wy).y;
      ctx.fillText(`${(wy).toFixed(mG<1?1:0)}m`,36,sy);
    }
    ctx.restore();

    // snap indicator
    if (this.snapGrid) {
      ctx.save(); ctx.fillStyle='#22c55e'; ctx.font='bold 9px sans-serif'; ctx.textAlign='right'; ctx.textBaseline='bottom';
      ctx.fillText(`SNAP ${this.gridSize}m`,this.W-6,this.H-4);
      ctx.restore();
    }

    // scale bar
    this._drawScaleBar();
  }

  _drawScaleBar() {
    const ctx=this.ctx, p=this.ppm;
    const targets=[0.1,0.25,0.5,1,2,5,10,20,50,100,200];
    let bm=1; for(const t of targets){if(t*p>=50&&t*p<=120){bm=t;break;}}
    const bPx=bm*p, bx=this.W-bPx-20, by=this.H-14;
    ctx.save();
    ctx.strokeStyle='#475569'; ctx.lineWidth=2; ctx.fillStyle='#1e293b'; ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+bPx,by);ctx.moveTo(bx,by-4);ctx.lineTo(bx,by+4);ctx.moveTo(bx+bPx,by-4);ctx.lineTo(bx+bPx,by+4);ctx.stroke();
    ctx.fillText(bm>=1?`${bm}m`:`${bm*100}cm`,bx+bPx/2,by-2);
    ctx.restore();
  }

  _drawShape(s) {
    const ctx=this.ctx, p=this.ppm, z=this.zoom;
    ctx.save();

    if (s.type==='room') {
      const pts=s.points.map(pt=>this.w2s(pt.x,pt.y));
      ctx.globalAlpha=0.45; ctx.fillStyle=s.color||'#bfdbfe';
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.closePath();ctx.fill();
      ctx.globalAlpha=1; ctx.strokeStyle=s.color||'#bfdbfe'; ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.closePath();ctx.stroke();
      // label
      let cx=0,cy=0;s.points.forEach(pt=>{cx+=pt.x;cy+=pt.y;});cx/=s.points.length;cy/=s.points.length;
      const csp=this.w2s(cx,cy);
      ctx.fillStyle='#1e293b'; ctx.font=`bold ${Math.max(10,Math.min(14,13*z))}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(s.label||'Room',csp.x,csp.y-8);
      if(s.areaSqm>0){ctx.font=`${Math.max(9,Math.min(11,10*z))}px sans-serif`; ctx.fillStyle='#475569'; ctx.fillText(`${s.areaSqm.toFixed(2)} sqm`,csp.x,csp.y+8);}

    } else if (s.type==='wall') {
      const s1=this.w2s(s.x1,s.y1), s2=this.w2s(s.x2,s.y2);
      const dx=s2.x-s1.x, dy=s2.y-s1.y, len=Math.hypot(dx,dy);
      if(len<1){ctx.restore();return;}
      const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
      const th=(s.thickness||0.23)*p/2;
      // filled wall rectangle
      ctx.fillStyle='#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(s1.x+nx*th,s1.y+ny*th); ctx.lineTo(s2.x+nx*th,s2.y+ny*th);
      ctx.lineTo(s2.x-nx*th,s2.y-ny*th); ctx.lineTo(s1.x-nx*th,s1.y-ny*th);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#334155'; ctx.lineWidth=Math.max(1.5,th*0.4);
      ctx.stroke();
      // dimension
      if(s.dimLabel) this._drawLineDim(s.x1,s.y1,s.x2,s.y2,s.dimLabel,s.dimOffset||(-1));

    } else if (s.type==='building'||s.type==='custom-block') {
      const sp=this.w2s(s.x,s.y), sw=s.w*p, sh=s.h*p;
      if(s.type==='custom-block'){
        const cm={misc:{f:'rgba(139,92,246,0.2)',st:'#7c3aed'},well:{f:'rgba(6,182,212,0.2)',st:'#0891b2'},tank:{f:'rgba(245,158,11,0.2)',st:'#b45309'},power:{f:'rgba(239,68,68,0.2)',st:'#b91c1c'},compound:{f:'rgba(16,185,129,0.15)',st:'#047857'}};
        const cs=cm[s.blockStyle]||cm.misc;
        ctx.fillStyle=cs.f; ctx.strokeStyle=cs.st;
      } else {
        const bm={rcc:{f:'rgba(59,130,246,0.25)',st:'#1d4ed8'},assam:{f:'rgba(16,185,129,0.25)',st:'#047857'},'temp-building':{f:'rgba(245,158,11,0.25)',st:'#b45309'},'temp-shed':{f:'rgba(120,113,108,0.15)',st:'#78716c',dash:[4,4]}};
        const bs=bm[s.structureType]||{f:'rgba(226,232,240,0.35)',st:'#64748b'};
        ctx.fillStyle=bs.f; ctx.strokeStyle=bs.st;
        if(bs.dash) ctx.setLineDash(bs.dash);
      }
      ctx.fillRect(sp.x,sp.y,sw,sh);
      ctx.lineWidth=1.5; ctx.strokeRect(sp.x,sp.y,sw,sh); ctx.setLineDash([]);
      // label
      ctx.fillStyle='#0f172a'; ctx.font=`bold ${Math.max(9,Math.min(13,11*z))}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      const lbl=s.label||'Block';
      lbl.split('\n').forEach((l,i,a)=>ctx.fillText(l,sp.x+sw/2,sp.y+sh/2-(a.length-1)*7+i*13));
      // dimensions
      if(s.dimW) this._drawBoxDim(s.x,s.y,s.x+s.w,s.y,s.dimW,s.dimWOffset||(-1.5));
      if(s.dimH) this._drawBoxDim(s.x,s.y,s.x,s.y+s.h,s.dimH,s.dimHOffset||(-1.5));

    } else if (s.type==='polygon-building') {
      const bm2={rcc:{f:'rgba(59,130,246,0.25)',st:'#1d4ed8'},assam:{f:'rgba(16,185,129,0.25)',st:'#047857'},'temp-building':{f:'rgba(245,158,11,0.25)',st:'#b45309'},'temp-shed':{f:'rgba(120,113,108,0.15)',st:'#78716c',dash:[4,4]}};
      const bs2=bm2[s.structureType]||{f:'rgba(203,213,225,0.4)',st:'#64748b'};
      ctx.fillStyle=bs2.f; ctx.strokeStyle=bs2.st; if(bs2.dash)ctx.setLineDash(bs2.dash);
      const pts=s.points.map(pt=>this.w2s(pt.x,pt.y));
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.closePath();ctx.fill();
      ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.closePath();ctx.stroke();ctx.setLineDash([]);
      let cx=0,cy=0;s.points.forEach(pt=>{cx+=pt.x;cy+=pt.y;});cx/=s.points.length;cy/=s.points.length;
      const csp2=this.w2s(cx,cy);
      ctx.fillStyle='#0f172a'; ctx.font=`bold ${Math.max(9,Math.min(13,11*z))}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(s.label||'Building',csp2.x,csp2.y);

    } else if (s.type==='road') {
      const sy1=this.w2s(0,s.y).y, sy2=this.w2s(0,s.y+s.h).y, rh=sy2-sy1;
      ctx.fillStyle='#f1f5f9'; ctx.fillRect(0,sy1,this.W,rh);
      ctx.strokeStyle='#94a3b8'; ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,sy1);ctx.lineTo(this.W,sy1);ctx.moveTo(0,sy2);ctx.lineTo(this.W,sy2);ctx.stroke();
      ctx.strokeStyle='#cbd5e1'; ctx.lineWidth=1; ctx.setLineDash([15,15]);
      ctx.beginPath();ctx.moveTo(0,(sy1+sy2)/2);ctx.lineTo(this.W,(sy1+sy2)/2);ctx.stroke(); ctx.setLineDash([]);
      ctx.font=`bold ${Math.max(10,Math.min(15,13*z))}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      if(s.leftLabel){ctx.fillStyle='#64748b';ctx.fillText(`← ${s.leftLabel}`,this.W*0.2,(sy1+sy2)/2);}
      ctx.fillStyle='#0f172a'; ctx.fillText(s.label||'',(this.W/2),(sy1+sy2)/2);
      if(s.rightLabel){ctx.fillStyle='#64748b';ctx.fillText(`${s.rightLabel} →`,this.W*0.8,(sy1+sy2)/2);}

    } else if (s.type==='text') {
      const sp=this.w2s(s.x,s.y);
      ctx.fillStyle='#0f172a'; ctx.font=`bold ${Math.max(9,Math.min(16,13*z))}px sans-serif`;
      ctx.textBaseline='alphabetic'; ctx.fillText(s.text||'',sp.x,sp.y);

    } else if (s.type==='line') {
      const s1=this.w2s(s.x1,s.y1),s2=this.w2s(s.x2,s.y2);
      ctx.strokeStyle='#334155'; ctx.lineWidth=1.5;
      if(s.style==='dashed')ctx.setLineDash([8,6]);
      ctx.beginPath();ctx.moveTo(s1.x,s1.y);ctx.lineTo(s2.x,s2.y);ctx.stroke();ctx.setLineDash([]);
      if(s.label){const mx=(s1.x+s2.x)/2,my=(s1.y+s2.y)/2;ctx.font=`italic ${Math.max(9,10*z)}px sans-serif`;ctx.fillStyle='#64748b';ctx.textAlign='center';ctx.fillText(s.label,mx,my-6);}

    } else if (s.type==='boundary-wall') {
      const s1=this.w2s(s.x1,s.y1),s2=this.w2s(s.x2,s.y2);
      const dx=s2.x-s1.x,dy=s2.y-s1.y,len=Math.hypot(dx,dy);
      if(len<1){ctx.restore();return;}
      const ux=dx/len,uy=dy/len,nx=-uy,ny=ux,bOff=3.5;
      ctx.strokeStyle='#991b1b'; ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(s1.x+nx*bOff,s1.y+ny*bOff);ctx.lineTo(s2.x+nx*bOff,s2.y+ny*bOff);ctx.moveTo(s1.x-nx*bOff,s1.y-ny*bOff);ctx.lineTo(s2.x-nx*bOff,s2.y-ny*bOff);ctx.stroke();
      ctx.lineWidth=1;
      for(let k=0;k<=Math.floor(len/12);k++){const t=k*12,hx=s1.x+ux*t,hy=s1.y+uy*t;ctx.beginPath();ctx.moveTo(hx+nx*5,hy+ny*5);ctx.lineTo(hx-nx*5,hy-ny*5);ctx.stroke();}
      if(s.dimLabel) this._drawLineDim(s.x1,s.y1,s.x2,s.y2,s.dimLabel,s.dimOffset||(-1));

    } else if (s.type==='gate') {
      const s1=this.w2s(s.x1,s.y1),s2=this.w2s(s.x2,s.y2);
      const dx=s2.x-s1.x,dy=s2.y-s1.y,gLen=Math.hypot(dx,dy),gA=Math.atan2(dy,dx);
      ctx.fillStyle='#1e293b'; [s1,s2].forEach(pt=>{ctx.beginPath();ctx.arc(pt.x,pt.y,4,0,Math.PI*2);ctx.fill();});
      ctx.strokeStyle='#d97706'; ctx.lineWidth=2.5;
      ctx.beginPath();ctx.moveTo(s1.x,s1.y);ctx.lineTo(s1.x+Math.cos(gA-Math.PI/4)*gLen/2,s1.y+Math.sin(gA-Math.PI/4)*gLen/2);
      ctx.moveTo(s2.x,s2.y);ctx.lineTo(s2.x+Math.cos(gA+Math.PI-Math.PI/4)*gLen/2,s2.y+Math.sin(gA+Math.PI-Math.PI/4)*gLen/2);ctx.stroke();
      ctx.font=`bold ${Math.max(8,9*z)}px sans-serif`;ctx.fillStyle='#d97706';ctx.textAlign='center';
      ctx.fillText(s.label||'GATE',(s1.x+s2.x)/2,(s1.y+s2.y)/2-10);
      if(s.dimLabel) this._drawLineDim(s.x1,s.y1,s.x2,s.y2,s.dimLabel,s.dimOffset||(-1));

    } else if (s.type==='gate-toran') {
      const s1=this.w2s(s.x1,s.y1),s2=this.w2s(s.x2,s.y2);
      const dx=s2.x-s1.x,dy=s2.y-s1.y,tLen=Math.hypot(dx,dy);
      if(tLen<2){ctx.restore();return;}
      const tmx=(s1.x+s2.x)/2,tmy=(s1.y+s2.y)/2;
      const tux=dx/tLen,tuy=dy/tLen; let tnx=-tuy,tny=tux;
      if(tny>0||(tny===0&&tnx>0)){tnx=-tnx;tny=-tny;}
      const aH=Math.min(tLen*0.45,40);
      const cOx=tmx+tnx*aH,cOy=tmy+tny*aH;
      ctx.fillStyle='#1a5c3b';[s1,s2].forEach(pt=>{ctx.beginPath();ctx.arc(pt.x,pt.y,5,0,Math.PI*2);ctx.fill();});
      ctx.strokeStyle='#047857';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(s1.x,s1.y);ctx.quadraticCurveTo(cOx,cOy,s2.x,s2.y);ctx.stroke();
      const cIx=tmx+tnx*aH*0.65,cIy=tmy+tny*aH*0.65;
      ctx.strokeStyle='#10b981';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(s1.x,s1.y);ctx.quadraticCurveTo(cIx,cIy,s2.x,s2.y);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#047857';for(let i=0;i<=4;i++){const t=i/4;const hx=(1-t)**2*s1.x+2*(1-t)*t*cOx+t**2*s2.x,hy=(1-t)**2*s1.y+2*(1-t)*t*cOy+t**2*s2.y;ctx.beginPath();ctx.arc(hx,hy,2,0,Math.PI*2);ctx.fill();}
      ctx.font=`bold ${Math.max(8,9*z)}px sans-serif`;ctx.fillStyle='#065f46';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(s.label||'GATE WITH TORAN',cOx,cOy-6);ctx.textBaseline='alphabetic';
      if(s.dimLabel) this._drawLineDim(s.x1,s.y1,s.x2,s.y2,s.dimLabel,s.dimOffset||(-1));

    } else if (s.type==='dimension') {
      this._drawDimAnnotation(s);

    } else if (s.type==='freehand') {
      if(!s.points||s.points.length<2){ctx.restore();return;}
      const pts=s.points.map(pt=>this.w2s(pt.x,pt.y));
      ctx.strokeStyle='#334155';ctx.lineWidth=1.5;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.stroke();

    } else if (s.type==='polygon') {
      const pts=s.points.map(pt=>this.w2s(pt.x,pt.y));
      ctx.fillStyle='rgba(13,148,136,0.08)';ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.closePath();ctx.fill();
      ctx.strokeStyle='#0d9488';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.closePath();ctx.stroke();
      for(let j=0;j<s.points.length;j++){const n=(j+1)%s.points.length,p1=s.points[j],p2=s.points[n];if(p1.sideLength)this._drawBoxDim(p1.x,p1.y,p2.x,p2.y,`${p1.sideLength.toFixed(2)}m`,0.8);}
      let pcx=0,pcy=0;s.points.forEach(pt=>{pcx+=pt.x;pcy+=pt.y;});pcx/=s.points.length;pcy/=s.points.length;
      const csp3=this.w2s(pcx,pcy);
      ctx.fillStyle='#0f766e';ctx.font=`bold ${Math.max(10,12*z)}px sans-serif`;ctx.textAlign='center';ctx.fillText(s.label||'Plot',csp3.x,csp3.y-8);
      ctx.fillStyle='#475569';ctx.font=`${Math.max(9,10*z)}px sans-serif`;ctx.fillText(`${s.areaSqm.toFixed(2)} sqm`,csp3.x,csp3.y+8);
    }

    ctx.restore();
  }

  // ── dim helpers ──
  _drawBoxDim(wx1,wy1,wx2,wy2,label,worldOff) {
    const s1=this.w2s(wx1,wy1),s2=this.w2s(wx2,wy2);
    const dx=s2.x-s1.x,dy=s2.y-s1.y,len=Math.hypot(dx,dy);
    if(!label||len<10){return;}
    const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
    const pxOff=worldOff*this.ppm;
    const ctx=this.ctx;
    ctx.save();
    ctx.strokeStyle='#475569';ctx.fillStyle='#475569';ctx.lineWidth=1;
    ctx.font=`${Math.max(9,Math.min(11,10*this.zoom))}px sans-serif`;
    const ax1=s1.x+nx*pxOff,ay1=s1.y+ny*pxOff,ax2=s2.x+nx*pxOff,ay2=s2.y+ny*pxOff;
    ctx.beginPath();ctx.moveTo(s1.x+nx*(pxOff-5),s1.y+ny*(pxOff-5));ctx.lineTo(s1.x+nx*(pxOff+5),s1.y+ny*(pxOff+5));
    ctx.moveTo(s2.x+nx*(pxOff-5),s2.y+ny*(pxOff-5));ctx.lineTo(s2.x+nx*(pxOff+5),s2.y+ny*(pxOff+5));ctx.stroke();
    ctx.beginPath();ctx.moveTo(ax1,ay1);ctx.lineTo(ax2,ay2);ctx.stroke();
    const hd=(x,y,a)=>{const sz=5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-sz*Math.cos(a-Math.PI/6),y-sz*Math.sin(a-Math.PI/6));ctx.lineTo(x-sz*Math.cos(a+Math.PI/6),y-sz*Math.sin(a+Math.PI/6));ctx.closePath();ctx.fill();};
    const ang=Math.atan2(dy,dx);hd(ax1,ay1,ang);hd(ax2,ay2,ang+Math.PI);
    const mx=(ax1+ax2)/2,my=(ay1+ay2)/2;
    ctx.textAlign='center';ctx.textBaseline='middle';
    const tw=ctx.measureText(label).width+6;
    ctx.fillStyle='rgba(255,255,255,0.92)';ctx.fillRect(mx-tw/2,my-8,tw,16);
    ctx.fillStyle='#1e293b';ctx.fillText(label,mx,my);
    ctx.restore();
  }

  _drawLineDim(wx1,wy1,wx2,wy2,label,worldOff) {
    if(!label)return;
    const s1=this.w2s(wx1,wy1),s2=this.w2s(wx2,wy2);
    const dx=s2.x-s1.x,dy=s2.y-s1.y,len=Math.hypot(dx,dy);
    if(len<4)return;
    const nx=-dy/len,ny=dx/len,pxOff=worldOff*this.ppm;
    const mx=(s1.x+s2.x)/2+nx*pxOff,my=(s1.y+s2.y)/2+ny*pxOff;
    const ctx=this.ctx; ctx.save();
    ctx.font=`bold ${Math.max(9,Math.min(11,10*this.zoom))}px sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    const tw=ctx.measureText(label).width+6;
    ctx.fillStyle='rgba(255,255,255,0.9)';ctx.fillRect(mx-tw/2,my-8,tw,16);
    ctx.strokeStyle='#64748b';ctx.lineWidth=0.5;ctx.strokeRect(mx-tw/2,my-8,tw,16);
    ctx.fillStyle='#1e293b';ctx.fillText(label,mx,my);
    ctx.restore();
  }

  _drawDimAnnotation(s) {
    const s1=this.w2s(s.x1,s.y1),s2=this.w2s(s.x2,s.y2);
    const dx=s2.x-s1.x,dy=s2.y-s1.y,len=Math.hypot(dx,dy);
    if(len<4)return;
    const nx=-dy/len,ny=dx/len,pxOff=(s.dimOffset||(-1))*this.ppm;
    const ctx=this.ctx; ctx.save();
    ctx.strokeStyle='#2563eb';ctx.fillStyle='#2563eb';ctx.lineWidth=1.5;
    // extension lines
    ctx.beginPath();
    ctx.moveTo(s1.x+nx*4,s1.y+ny*4);ctx.lineTo(s1.x+nx*(pxOff-4*(pxOff<0?-1:1)),s1.y+ny*(pxOff-4*(pxOff<0?-1:1)));
    ctx.moveTo(s2.x+nx*4,s2.y+ny*4);ctx.lineTo(s2.x+nx*(pxOff-4*(pxOff<0?-1:1)),s2.y+ny*(pxOff-4*(pxOff<0?-1:1)));
    ctx.stroke();
    const ax1=s1.x+nx*pxOff,ay1=s1.y+ny*pxOff,ax2=s2.x+nx*pxOff,ay2=s2.y+ny*pxOff;
    ctx.beginPath();ctx.moveTo(ax1,ay1);ctx.lineTo(ax2,ay2);ctx.stroke();
    const hd=(x,y,a)=>{const sz=7;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-sz*Math.cos(a-Math.PI/6),y-sz*Math.sin(a-Math.PI/6));ctx.lineTo(x-sz*Math.cos(a+Math.PI/6),y-sz*Math.sin(a+Math.PI/6));ctx.closePath();ctx.fill();};
    const ang=Math.atan2(dy,dx);hd(ax1,ay1,ang);hd(ax2,ay2,ang+Math.PI);
    const label=s.manualLabel||s.label||`${Math.hypot(s.x2-s.x1,s.y2-s.y1).toFixed(2)}m`;
    const mx=(ax1+ax2)/2,my=(ay1+ay2)/2;
    ctx.font=`bold ${Math.max(9,Math.min(12,11*this.zoom))}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    const tw=ctx.measureText(label).width+8;
    ctx.fillStyle='rgba(219,234,254,0.95)';ctx.fillRect(mx-tw/2,my-9,tw,18);
    ctx.strokeStyle='#2563eb';ctx.lineWidth=0.5;ctx.strokeRect(mx-tw/2,my-9,tw,18);
    ctx.fillStyle='#1d4ed8';ctx.fillText(label,mx,my);
    ctx.restore();
  }

  // ── preview while drawing ──
  _drawPreview() {
    const ctx=this.ctx, p=this.previewPt;
    if(!p) return;
    ctx.save();

    // snap indicator dot
    if(this.snapEndpt||this.snapGrid){
      ctx.strokeStyle='#22c55e';ctx.lineWidth=1.5;
      ctx.beginPath();const sp=this.w2s(p.x,p.y);ctx.arc(sp.x,sp.y,5,0,Math.PI*2);ctx.stroke();
    }

    // wall chain preview
    if(this.mode==='wall'&&this.wallChain.length>0){
      const pts=[...this.wallChain,p].map(pt=>this.w2s(pt.x,pt.y));
      ctx.strokeStyle='#475569';ctx.lineWidth=0.23*this.ppm;ctx.globalAlpha=0.3;
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.stroke();
      ctx.globalAlpha=1;
      ctx.strokeStyle='#334155';ctx.lineWidth=1;ctx.setLineDash([5,5]);
      ctx.beginPath();ctx.moveTo(pts[pts.length-2].x,pts[pts.length-2].y);ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);ctx.stroke();ctx.setLineDash([]);
      // live length
      const last=this.wallChain[this.wallChain.length-1];
      const len=Math.hypot(p.x-last.x,p.y-last.y);
      if(len>0.02){const sp2=this.w2s((last.x+p.x)/2,(last.y+p.y)/2);this._drawLiveLen(`${len.toFixed(2)}m`,sp2);}
      // dot at each node
      this.wallChain.forEach(pt=>{const s=this.w2s(pt.x,pt.y);ctx.beginPath();ctx.arc(s.x,s.y,4,0,Math.PI*2);ctx.fillStyle='#334155';ctx.fill();});
    }

    // poly / room preview
    if((this.mode==='polybuilding'||this.mode==='room')&&this.polyChain.length>0){
      const pts=[...this.polyChain,p].map(pt=>this.w2s(pt.x,pt.y));
      ctx.strokeStyle='#64748b';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.stroke();ctx.setLineDash([]);
      this.polyChain.forEach(pt=>{const s=this.w2s(pt.x,pt.y);ctx.beginPath();ctx.arc(s.x,s.y,4,0,Math.PI*2);ctx.fillStyle='#475569';ctx.fill();});
    }

    // line-type drag preview
    if(this._isLinearMode()&&this.isDown&&this.wallChain.length===1){
      const s1=this.w2s(this.wallChain[0].x,this.wallChain[0].y),s2=this.w2s(p.x,p.y);
      ctx.strokeStyle=this.mode==='dimension'?'#2563eb':'#64748b';ctx.lineWidth=1.5;ctx.setLineDash([5,5]);
      ctx.beginPath();ctx.moveTo(s1.x,s1.y);ctx.lineTo(s2.x,s2.y);ctx.stroke();ctx.setLineDash([]);
      const len=Math.hypot(p.x-this.wallChain[0].x,p.y-this.wallChain[0].y);
      if(len>0.02){const sp2=this.w2s((this.wallChain[0].x+p.x)/2,(this.wallChain[0].y+p.y)/2);this._drawLiveLen(`${len.toFixed(2)}m`,sp2);}
      if(this.shiftDown){const s2sp=this.w2s(p.x,p.y);ctx.fillStyle='rgba(30,41,59,0.8)';ctx.font='bold 11px sans-serif';ctx.fillText(`${Math.round(Math.atan2(p.y-this.wallChain[0].y,p.x-this.wallChain[0].x)*180/Math.PI)}°`,s2sp.x+8,s2sp.y-8);}
    }

    // freehand
    if(this.mode==='freehand'&&this.isDown&&this.wallChain.length>1){
      const pts=this.wallChain.map(pt=>this.w2s(pt.x,pt.y));
      ctx.strokeStyle='#334155';ctx.lineWidth=1.5;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));ctx.stroke();
    }

    ctx.restore();
  }

  _drawLiveLen(label, sp) {
    const ctx=this.ctx;
    ctx.save();
    ctx.font='bold 11px sans-serif';
    const tw=ctx.measureText(label).width+10;
    ctx.fillStyle='rgba(30,41,59,0.88)';ctx.fillRect(sp.x-tw/2,sp.y-11,tw,20);
    ctx.fillStyle='#f0f9ff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,sp.x,sp.y);
    ctx.restore();
  }

  // ── selection overlay ──
  _drawSelection(s) {
    const ctx=this.ctx, p=this.ppm;
    ctx.save();ctx.strokeStyle='#2563eb';ctx.lineWidth=1;

    if(s.type==='building'||s.type==='custom-block'){
      const sp=this.w2s(s.x,s.y),sw=s.w*p,sh=s.h*p;
      ctx.setLineDash([4,3]);ctx.strokeRect(sp.x-2,sp.y-2,sw+4,sh+4);ctx.setLineDash([]);
      ctx.fillStyle='#2563eb';
      [{x:s.x,y:s.y},{x:s.x+s.w,y:s.y},{x:s.x+s.w,y:s.y+s.h},{x:s.x,y:s.y+s.h}].forEach(c=>{const cs=this.w2s(c.x,c.y);ctx.fillRect(cs.x-4,cs.y-4,8,8);});
      this._dimHandle(this.w2s(s.x+s.w/2,s.y+(s.dimWOffset||(-1.5))));
      this._dimHandle(this.w2s(s.x+(s.dimHOffset||(-1.5)),s.y+s.h/2));
    } else if(s.type==='road'){
      const sy1=this.w2s(0,s.y).y,sh=s.h*p;ctx.setLineDash([4,3]);ctx.strokeRect(0,sy1-2,this.W,sh+4);ctx.setLineDash([]);
    } else if(s.type==='text'){
      const sp=this.w2s(s.x,s.y);ctx.strokeRect(sp.x-4,sp.y-16,120,22);
    } else if(this._isLinear(s)||s.type==='wall'){
      const s1=this.w2s(s.x1,s.y1),s2=this.w2s(s.x2,s.y2);
      ctx.fillStyle='#2563eb';[s1,s2].forEach(pt=>{ctx.beginPath();ctx.arc(pt.x,pt.y,5,0,Math.PI*2);ctx.fill();});
      const dx=s.x2-s.x1,dy=s.y2-s.y1,l=Math.hypot(dx,dy)||1;
      const nx=-dy/l,ny=dx/l,off=s.dimOffset||(-1);
      this._dimHandle(this.w2s((s.x1+s.x2)/2+nx*off,(s.y1+s.y2)/2+ny*off));
    } else if(s.points){
      s.points.forEach(pt=>{const ps=this.w2s(pt.x,pt.y);ctx.beginPath();ctx.arc(ps.x,ps.y,4,0,Math.PI*2);ctx.fillStyle='#2563eb';ctx.fill();});
    }
    ctx.restore();
  }

  _dimHandle(sp){const ctx=this.ctx;ctx.save();ctx.fillStyle='#f97316';ctx.beginPath();ctx.moveTo(sp.x,sp.y-5);ctx.lineTo(sp.x+5,sp.y);ctx.lineTo(sp.x,sp.y+5);ctx.lineTo(sp.x-5,sp.y);ctx.closePath();ctx.fill();ctx.restore();}

  _drawStatus() {
    const ctx=this.ctx;
    if(!this.previewPt)return;
    const wp=this.previewPt;
    const label=`x:${wp.x.toFixed(2)}m  y:${wp.y.toFixed(2)}m`;
    ctx.save(); ctx.font='10px monospace'; ctx.fillStyle='rgba(30,41,59,0.7)';
    const tw=ctx.measureText(label).width+10;
    ctx.fillRect(4,this.H-18,tw,14); ctx.fillStyle='#f8fafc'; ctx.textBaseline='middle'; ctx.fillText(label,8,this.H-11);
    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PUBLIC CONTROLS
  // ═══════════════════════════════════════════════════════════════════════
  setScale(ratioN) {
    // ratioN = 50, 100, 200 ... (1:N)
    // 1:100 → 50 px/m  |  1:50 → 100 px/m  |  1:200 → 25 px/m
    this.basePPM = Math.round(5000 / ratioN);
    this.draw();
  }

  zoomTo(factor) {
    const cx=this.W/2,cy=this.H/2;
    const wp=this.s2w(cx,cy);
    this.zoom=Math.min(this.MAX_ZOOM,Math.max(this.MIN_ZOOM,this.zoom*factor));
    this.panX=cx-wp.x*this.ppm; this.panY=cy-wp.y*this.ppm;
    if(this.onZoomChange) this.onZoomChange(this.zoom);
    this.draw();
  }

  resetView(){this.zoom=1;this.panX=40;this.panY=40;if(this.onZoomChange)this.onZoomChange(1);this.draw();}

  fitToContent(){
    if(!this.shapes.length){this.resetView();return;}
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    const expand=(x,y)=>{minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);};
    this.shapes.forEach(s=>{
      if(s.x!==undefined){expand(s.x,s.y);expand(s.x+(s.w||0),s.y+(s.h||0));}
      if(s.x1!==undefined){expand(s.x1,s.y1);expand(s.x2,s.y2);}
      if(s.y!==undefined&&s.h!==undefined&&s.x1===undefined&&s.x===undefined){expand(0,s.y);expand(this.W/this.ppm,s.y+s.h);}
      if(s.points)s.points.forEach(p=>expand(p.x,p.y));
    });
    const pad=2,rW=maxX-minX+pad*2,rH=maxY-minY+pad*2;
    const newZoom=Math.min(this.MAX_ZOOM,Math.max(this.MIN_ZOOM,Math.min((this.W-60)/(rW*this.basePPM),(this.H-60)/(rH*this.basePPM))));
    this.zoom=newZoom;
    this.panX=(this.W-(maxX+minX+pad*2)*this.basePPM*newZoom)/2;
    this.panY=(this.H-(maxY+minY+pad*2)*this.basePPM*newZoom)/2;
    if(this.onZoomChange)this.onZoomChange(this.zoom);
    this.draw();
  }

  closePolygonBuilding(){
    if((this.mode==='polybuilding'||this.mode==='room')&&this.polyChain.length>=3) this._commitPolyChain();
    else if(this.mode==='wall'&&this.wallChain.length>=2) this._commitWallChain(true);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MAP TILES
  // ═══════════════════════════════════════════════════════════════════════
  lon2tile(lon,z){return(lon+180)/360*2**z;}
  lat2tile(lat,z){return(1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*2**z;}

  loadMapBackground(lat,lon,zoom=17,type='satellite'){
    this.mapLat=parseFloat(lat);this.mapLon=parseFloat(lon);this.mapZoom=parseInt(zoom);this.mapType=type;
    const cx=this.lon2tile(this.mapLon,this.mapZoom),cy=this.lat2tile(this.mapLat,this.mapZoom);
    const off=document.createElement('canvas');off.width=this.W;off.height=this.H;
    const oc=off.getContext('2d');oc.fillStyle='#fff';oc.fillRect(0,0,this.W,this.H);
    const proms=[];
    for(let x=Math.floor(cx-400/256);x<=Math.ceil(cx+400/256);x++){
      for(let y=Math.floor(cy-250/256);y<=Math.ceil(cy+250/256);y++){
        const max=2**this.mapZoom,wx=(x%max+max)%max,wy=(y%max+max)%max;
        const dx=(x-cx)*256+400,dy=(y-cy)*256+250;
        proms.push(new Promise(res=>{const img=new Image();img.crossOrigin='anonymous';
          img.onload=()=>{oc.drawImage(img,dx,dy,256,256);res(true);};img.onerror=()=>res(false);
          img.src=type==='satellite'?`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${this.mapZoom}/${wy}/${wx}`:`https://tile.openstreetmap.org/${this.mapZoom}/${wx}/${wy}.png`;
        }));
      }
    }
    Promise.all(proms).then(()=>{this.mapBgImage=off;this.mapBgLoaded=true;this.draw();});
  }

  clearMapBackground(){this.mapBgImage=null;this.mapBgLoaded=false;this.draw();}

  panMap(dx,dy){
    if(!this.mapBgLoaded)return;
    const ts=256,sc=2**this.mapZoom;
    this.mapLon+=(dx/(ts*sc))*360;
    this.mapLat-=(dy/(ts*sc))*360*Math.cos(this.mapLat*Math.PI/180);
    this.loadMapBackground(this.mapLat,this.mapLon,this.mapZoom,this.mapType);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  GPS IMPORT
  // ═══════════════════════════════════════════════════════════════════════
  importGpsTrace(gpsPoints){
    if(gpsPoints.length<3)return false;
    const ref=gpsPoints[0];
    const raw=gpsPoints.map(p=>({dx:(p.lon-ref.lon)*111320*Math.cos(ref.lat*Math.PI/180),dy:(p.lat-ref.lat)*110574,lat:p.lat,lon:p.lon}));
    for(let i=0;i<raw.length;i++){const n=raw[(i+1)%raw.length];raw[i].sideLength=Math.hypot(n.dx-raw[i].dx,n.dy-raw[i].dy);}
    let area=0;for(let i=0;i<raw.length;i++){const j=(i+1)%raw.length;area+=raw[i].dx*raw[j].dy-raw[j].dx*raw[i].dy;}
    const areaSqm=Math.abs(area)/2,areaSqft=areaSqm*10.76391;
    const minX=Math.min(...raw.map(n=>n.dx)),maxX=Math.max(...raw.map(n=>n.dx));
    const minY=Math.min(...raw.map(n=>n.dy)),maxY=Math.max(...raw.map(n=>n.dy));
    const rX=(maxX-minX)||1,rY=(maxY-minY)||1;
    const avW=(this.W-100)/this.basePPM,avH=(this.H-100)/this.basePPM;
    const sc=Math.min(avW/rX,avH/rY);
    const oX=(avW-rX*sc)/2+2,oY=(avH-rY*sc)/2+2;
    const cPts=raw.map(n=>({x:n.dx*sc+oX,y:n.dy*sc+oY,sideLength:n.sideLength}));
    this.pushHistory();
    this.shapes=this.shapes.filter(s=>s.type!=='polygon');
    const poly={id:Date.now(),type:'polygon',points:cPts,areaSqm,areaSqft,label:'Plot Boundary'};
    this.shapes.push(poly);this.selectedShape=poly;this.draw();
    if(this.onSelectionChange)this.onSelectionChange(poly);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  DATA I/O
  // ═══════════════════════════════════════════════════════════════════════
  loadData(shapes){this.shapes=shapes||[];this.selectedShape=null;this.wallChain=[];this.polyChain=[];this.history=[];this.future=[];this.draw();if(this.onHistoryChange)this.onHistoryChange(0,0);}
  exportData(){return this.shapes;}
  exportImage(){
    const prev=this.selectedShape;
    this.selectedShape=null;
    this.isExporting=true;
    this.draw();
    const url=this.canvas.toDataURL('image/png');
    this.isExporting=false;
    this.selectedShape=prev;
    this.draw();
    return url;
  }

  panCanvas(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.draw();
  }

  _drawA4Frame() {
    const ctx = this.ctx;
    ctx.save();
    const w = 593;
    const h = 560;
    const x = (this.W - w) / 2;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
    ctx.fillRect(0, 0, x, this.H);
    ctx.fillRect(x + w, 0, this.W - (x + w), this.H);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, this.H);
    ctx.moveTo(x + w, 0); ctx.lineTo(x + w, this.H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#2563eb';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('A4 PRINT BORDER', x + 50, 20);
    ctx.fillText('A4 PRINT BORDER', x + w - 50, 20);
    ctx.restore();
  }

  _polygonArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return area / 2;
  }

  _getVerticesOfBlock(s) {
    if (s.type === 'building') {
      return [
        { x: s.x, y: s.y },
        { x: s.x + s.w, y: s.y },
        { x: s.x + s.w, y: s.y + s.h },
        { x: s.x, y: s.y + s.h }
      ];
    } else if (s.type === 'polygon-building') {
      let pts = s.points.map(p => ({ x: p.x, y: p.y }));
      if (this._polygonArea(pts) < 0) {
        pts.reverse();
      }
      return pts;
    }
    return [];
  }

  _areBlocksClose(s1, s2) {
    const poly1 = this._getVerticesOfBlock(s1);
    const poly2 = this._getVerticesOfBlock(s2);
    const TOL = 0.12;
    for (let i = 0; i < poly1.length; i++) {
      const p = poly1[i];
      for (let j = 0; j < poly2.length; j++) {
        const v = poly2[j], w = poly2[(j + 1) % poly2.length];
        if (this._distSeg(p, v, w) < TOL) return true;
      }
    }
    for (let i = 0; i < poly2.length; i++) {
      const p = poly2[i];
      for (let j = 0; j < poly1.length; j++) {
        const v = poly1[j], w = poly1[(j + 1) % poly1.length];
        if (this._distSeg(p, v, w) < TOL) return true;
      }
    }
    if (this._ptInPoly(poly1[0], poly2) || this._ptInPoly(poly2[0], poly1)) {
      return true;
    }
    return false;
  }

  _simplifyPolygon(pts) {
    if (pts.length < 3) return pts;
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const len1 = Math.hypot(dx1, dy1);
      const len2 = Math.hypot(dx2, dy2);
      if (len1 < 1e-4 || len2 < 1e-4) continue;
      const cross = dx1 * dy2 - dy1 * dx2;
      const dot = dx1 * dx2 + dy1 * dy2;
      const angle = Math.abs(Math.atan2(cross, dot));
      if (angle > 0.02) {
        res.push(curr);
      }
    }
    return res.length >= 3 ? res : pts;
  }

  _unionPolygons(polyA, polyB) {
    let A = polyA.map(p => ({ x: p.x, y: p.y }));
    let B = polyB.map(p => ({ x: p.x, y: p.y }));
    const SNAP_TOL = 0.12;

    for (let i = 0; i < B.length; i++) {
      let p = B[i];
      let snapped = false;
      for (let j = 0; j < A.length; j++) {
        if (Math.hypot(p.x - A[j].x, p.y - A[j].y) < SNAP_TOL) {
          B[i] = { x: A[j].x, y: A[j].y };
          snapped = true;
          break;
        }
      }
      if (snapped) continue;
      for (let j = 0; j < A.length; j++) {
        let nextJ = (j + 1) % A.length;
        let v = A[j], w = A[nextJ];
        let l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 > 1e-6) {
          let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
          t = Math.max(0, Math.min(1, t));
          let proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
          if (Math.hypot(p.x - proj.x, p.y - proj.y) < SNAP_TOL) {
            B[i] = proj;
            if (t > 0.001 && t < 0.999) {
              A.splice(nextJ, 0, proj);
              j++;
            }
            break;
          }
        }
      }
    }

    for (let i = 0; i < A.length; i++) {
      let p = A[i];
      let snapped = false;
      for (let j = 0; j < B.length; j++) {
        if (Math.hypot(p.x - B[j].x, p.y - B[j].y) < SNAP_TOL) {
          A[i] = { x: B[j].x, y: B[j].y };
          snapped = true;
          break;
        }
      }
      if (snapped) continue;
      for (let j = 0; j < B.length; j++) {
        let nextJ = (j + 1) % B.length;
        let v = B[j], w = B[nextJ];
        let l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 > 1e-6) {
          let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
          t = Math.max(0, Math.min(1, t));
          let proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
          if (Math.hypot(p.x - proj.x, p.y - proj.y) < SNAP_TOL) {
            A[i] = proj;
            if (t > 0.001 && t < 0.999) {
              B.splice(nextJ, 0, proj);
              j++;
            }
            break;
          }
        }
      }
    }

    const segments = [];
    for (let i = 0; i < A.length; i++) {
      segments.push({ p1: A[i], p2: A[(i + 1) % A.length], source: 'A' });
    }
    for (let i = 0; i < B.length; i++) {
      segments.push({ p1: B[i], p2: B[(i + 1) % B.length], source: 'B' });
    }

    const getIntersection = (s1, s2) => {
      const p1 = s1.p1, p2 = s1.p2, p3 = s2.p1, p4 = s2.p2;
      const tNum = (p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x);
      const uNum = (p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x);
      const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
      if (Math.abs(denom) < 1e-9) return null;
      const t = tNum / denom;
      const u = uNum / denom;
      if (t > 1e-5 && t < 1 - 1e-5 && u > 1e-5 && u < 1 - 1e-5) {
        return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y), t: t };
      }
      return null;
    };

    const allSegments = [];
    const segsA = segments.filter(s => s.source === 'A');
    const segsB = segments.filter(s => s.source === 'B');

    for (let i = 0; i < segsA.length; i++) {
      const sa = segsA[i];
      const splits = [];
      for (let j = 0; j < segsB.length; j++) {
        const ip = getIntersection(sa, segsB[j]);
        if (ip) splits.push(ip);
      }
      if (splits.length > 0) {
        splits.sort((s1, s2) => s1.t - s2.t);
        let prev = sa.p1;
        for (const sp of splits) {
          allSegments.push({ p1: prev, p2: { x: sp.x, y: sp.y }, source: 'A' });
          prev = { x: sp.x, y: sp.y };
        }
        allSegments.push({ p1: prev, p2: sa.p2, source: 'A' });
      } else {
        allSegments.push(sa);
      }
    }

    for (let i = 0; i < segsB.length; i++) {
      const sb = segsB[i];
      const splits = [];
      for (let j = 0; j < segsA.length; j++) {
        const ip = getIntersection(sb, segsA[j]);
        if (ip) splits.push(ip);
      }
      if (splits.length > 0) {
        splits.sort((s1, s2) => s1.t - s2.t);
        let prev = sb.p1;
        for (const sp of splits) {
          allSegments.push({ p1: prev, p2: { x: sp.x, y: sp.y }, source: 'B' });
          prev = { x: sp.x, y: sp.y };
        }
        allSegments.push({ p1: prev, p2: sb.p2, source: 'B' });
      } else {
        allSegments.push(sb);
      }
    }

    const validSegments = allSegments.filter(s => {
      return Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y) > 1e-4;
    });

    const vertices = [];
    const getUniqueVertex = (v) => {
      for (const uv of vertices) {
        if (Math.hypot(uv.x - v.x, uv.y - v.y) < 1e-4) return uv;
      }
      const newV = { x: v.x, y: v.y };
      vertices.push(newV);
      return newV;
    };

    for (const s of validSegments) {
      s.p1 = getUniqueVertex(s.p1);
      s.p2 = getUniqueVertex(s.p2);
    }

    const kept = [];
    const used = new Set();
    for (let i = 0; i < validSegments.length; i++) {
      if (used.has(i)) continue;
      const s1 = validSegments[i];
      let foundOpposite = false;
      for (let j = 0; j < validSegments.length; j++) {
        if (i === j || used.has(j)) continue;
        const s2 = validSegments[j];
        if (s1.p1 === s2.p2 && s1.p2 === s2.p1) {
          used.add(i); used.add(j);
          foundOpposite = true;
          break;
        }
      }
      if (foundOpposite) continue;
      let foundDuplicate = false;
      for (let j = 0; j < kept.length; j++) {
        const s2 = kept[j];
        if (s1.p1 === s2.p1 && s1.p2 === s2.p2) {
          foundDuplicate = true;
          break;
        }
      }
      if (!foundDuplicate) kept.push(s1);
    }

    const finalSegments = [];
    for (const s of kept) {
      const mid = { x: (s.p1.x + s.p2.x) / 2, y: (s.p1.y + s.p2.y) / 2 };
      if (s.source === 'A') {
        if (this._ptInPoly(mid, polyB)) continue;
      } else {
        if (this._ptInPoly(mid, polyA)) continue;
      }
      finalSegments.push(s);
    }

    const polys = [];
    const segmentsPool = [...finalSegments];
    while (segmentsPool.length > 0) {
      const poly = [];
      let curr = segmentsPool.shift();
      poly.push(curr.p1);
      let nextPt = curr.p2;
      for (let step = 0; step < 1000; step++) {
        let bestIdx = -1;
        let minDist = 1e-3;
        for (let i = 0; i < segmentsPool.length; i++) {
          const d = Math.hypot(segmentsPool[i].p1.x - nextPt.x, segmentsPool[i].p1.y - nextPt.y);
          if (d < minDist) {
            minDist = d;
            bestIdx = i;
          }
        }
        if (bestIdx !== -1) {
          const nextSeg = segmentsPool.splice(bestIdx, 1)[0];
          poly.push(nextSeg.p1);
          nextPt = nextSeg.p2;
        } else {
          break;
        }
      }
      if (poly.length >= 3) {
        polys.push(this._simplifyPolygon(poly));
      }
    }

    if (polys.length === 0) return null;
    polys.sort((p1, p2) => Math.abs(this._polygonArea(p2)) - Math.abs(this._polygonArea(p1)));
    return polys[0];
  }

  mergeSelectedTouching() {
    if (!this.selectedShape) return;
    if (this.selectedShape.type !== 'building' && this.selectedShape.type !== 'polygon-building') {
      return;
    }

    const buildingShapes = this.shapes.filter(s => s.type === 'building' || s.type === 'polygon-building');
    const toMerge = [this.selectedShape];
    const remaining = buildingShapes.filter(s => s.id !== this.selectedShape.id);
    
    let added = true;
    while (added) {
      added = false;
      for (let i = 0; i < remaining.length; i++) {
        const other = remaining[i];
        const isClose = toMerge.some(s => this._areBlocksClose(s, other));
        if (isClose) {
          toMerge.push(other);
          remaining.splice(i, 1);
          i--;
          added = true;
        }
      }
    }

    if (toMerge.length < 2) {
      alert("No other building blocks are close or touching the selected block.");
      return;
    }

    try {
      this.pushHistory();
      let mergedPoly = this._getVerticesOfBlock(toMerge[0]);
      for (let i = 1; i < toMerge.length; i++) {
        const nextPoly = this._getVerticesOfBlock(toMerge[i]);
        mergedPoly = this._unionPolygons(mergedPoly, nextPoly);
        if (!mergedPoly || mergedPoly.length < 3) {
          throw new Error("Could not compute valid union of the shapes.");
        }
      }

      const toMergeIds = new Set(toMerge.map(s => s.id));
      this.shapes = this.shapes.filter(s => !toMergeIds.has(s.id));

      const mergedShape = {
        id: Date.now(),
        type: 'polygon-building',
        points: mergedPoly,
        label: this.selectedShape.label || 'Merged Building Block',
        structureType: this.selectedShape.structureType || 'rcc',
        dimW: '',
        dimH: '',
        dimWOffset: -1.5,
        dimHOffset: -1.5
      };
      
      this.shapes.push(mergedShape);
      this.selectedShape = mergedShape;
      this.draw();

      if (this.onSelectionChange) {
        this.onSelectionChange(mergedShape);
      }
    } catch (err) {
      console.error(err);
      alert("Error merging blocks: " + err.message);
    }
  }
}
