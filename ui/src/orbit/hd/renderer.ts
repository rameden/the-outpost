// Orbit's HD view, drawn: the same system as the flat one, as lit worlds in three dimensions.
// A proof of concept, written straight against WebGL 2 with no library, so it adds nothing to
// what the page loads.
//
// What it's handed each frame (HdFrame) is everything: where the camera is, where each planet is
// and what its crew member is doing, what's crossing the sky. It keeps no state of its own but
// what the graphics card holds, so Orbit.tsx stays the one place that knows what's happening.
//
// How a frame is made:
//   1. The sky: dust and cloud a long way off, then the stars.
//   2. The solid things, each a square facing the camera on which a sphere is worked out a pixel
//      at a time (so they are perfectly round at any size, with no mesh): the sun, as plasma; the
//      planets, each a world you could live on (seas, land, cloud, ice at its poles) in its crew
//      member's colour, lit by the sun and lived on: a map of lights on its night side with
//      routes between them, an aurora, lightning in its storms, all of it quiet at camp and
//      busier as its crew member works; a station, or the rocks of a cluster being mined, for
//      anyone who has one of those instead; and the moons, a world's own (grey) and a quest's
//      (its crew member's colour).
//   3. Everything that glows, added on top: the table the system sits on (bearings, the rim, the
//      sun's ring going out), the contour lines, the air round each planet, the sun's corona, a
//      giant's rings, the stream from the sun to whoever is working, the comets, and (close to)
//      the satellites over each planet and the ships going out to its moons and back (frame.ts
//      says where each of those is; here they're points of light).
//   4. The picture is then given its bloom (what's bright spills light), a little lens, and grain.

import type { Camera3, Vec3 } from "./math.ts";

export type HdPoint = { pos: Vec3; size: number; color: Vec3; a: number };
export type HdPlanet = {
  pos: Vec3; radius: number; color: Vec3;
  kind: number;   // 0 a world, 4 a station, 5 a cluster of asteroids being mined (worlds.ts)
  // A cluster's rocks, each where it is: the first is the main one, with the rig on it. turned: how far it has tumbled.
  rocks?: { pos: Vec3; radius: number; seed: number; turned: number; rig: boolean }[];
  rough?: number; // how rough its rocks are
  seed: number; spin: number;
  // What this one is like (worlds.ts makes these up): how far it's tipped, its four settings (for a world: sea level,
  // cloud, where its ice begins, how dry it is; for a station: how it's built), how fine its features are, its second colour, its rings if it has any (in its radii), and how thick its air is.
  tilt: number; p: [number, number, number, number]; scale: number; color2: Vec3; ring: { inner: number; outer: number } | null; air: number;
  active: number;  // 0 at camp … 1 at work
  waiting: number; // 1 while it waits on you
  blip: number;    // a tool call's flash across it: 0 → 1 as it crosses, -1 none
  land: number;    // the ring as a quest lands: 0 → 1, -1 none
  moons: { pos: Vec3; radius: number; waiting: boolean; own?: boolean }[]; // own: one of the world's own, not a quest's
  grown?: number;  // how far its settlements have spread: 0 a first camp … 1 a world built over
};
export type HdFrame = {
  time: number; cam: Camera3;
  sun: { radius: number; active: number; waiting: number };
  planets: HdPlanet[];
  lines: { rot: number; color: Vec3; tone: number; lit: number; tail: boolean }[]; // the contour lines, in order outwards
  ping: { r: number; a: number }; // the sun's ring: how far out it is, and how bright
  reach: number;
  points: HdPoint[]; // comets and the streams, as points of light
};
export type HdRenderer = {
  resize(w: number, h: number, dpr: number): void;
  setLines(contours: [number, number][][]): void;
  draw(frame: HdFrame): void;
  dispose(): void;
};

const SUN: Vec3 = [1.0, 0.66, 0.2];
const OWN_MOON: Vec3 = [0.55, 0.55, 0.57]; // a world's own moon is grey rock; a quest's is its crew member's colour

// ---------- The shaders ----------
const NOISE = /* glsl */ `
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = .5, s = 0.; for(int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.02+vec3(1.7,9.2,3.1); a *= .5; } return s; }
float fbm3(vec3 p){ float a = .5, s = 0.; for(int i = 0; i < 3; i++){ s += a*noise(p); p = p*2.02+vec3(1.7,9.2,3.1); a *= .5; } return s; }
`;
// Two things GLSL leaves undefined, and that can come out as "not a number" (one such pixel, once the bloom has blurred
// it, is a black square): a negative number raised to a power, and a smoothstep with its edges the wrong way round.
// So: sq() to square, and fall(hi, lo, x) for "1 at lo and below, 0 at hi and above".
const HEAD = "#version 300 es\nprecision highp float;\nfloat sq(float x){ return x*x; }\nfloat fall(float hi, float lo, float x){ return 1.-smoothstep(lo, hi, x); }\n";

// A triangle that covers the screen, for the sky and for each step of the bloom.
const VS_SCREEN = HEAD + `out vec2 v_uv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); v_uv = p; gl_Position = vec4(p*2.-1., 0., 1.); }`;

const FS_SKY = HEAD + NOISE + `
uniform vec3 u_right, u_up, u_fwd; uniform vec2 u_tan, u_shift;
in vec2 v_uv; out vec4 o;
void main(){
  vec2 ndc = v_uv*2.-1. - u_shift;
  vec3 d = normalize(u_fwd + u_right*ndc.x*u_tan.x + u_up*ndc.y*u_tan.y);
  float n1 = fbm3(d*1.7+vec3(3.1,0.,7.7));
  float n2 = fbm3(d*3.4+vec3(11.,5.,2.)+n1);
  float band = exp(-sq(d.y*2.4+(n1-.5)*.9)*3.);            // a band of dust level with the system
  vec3 col = vec3(.018,.024,.052);
  col += vec3(.07,.10,.24)*band*n2;
  col += vec3(.30,.13,.05)*sq(max(n2-.42,0.))*4.*band;     // amber dust in it
  col += vec3(.11,.05,.19)*sq(max(n1-.48,0.))*5.;          // violet cloud, anywhere
  o = vec4(col, 1.);
}`;

// Points of light: the stars (a size in pixels, round the camera) and the comets (a size in the drawing's units).
const VS_POINTS = HEAD + `layout(location=0) in vec4 a_pos; layout(location=1) in vec4 a_col;
uniform mat4 u_vp; uniform vec3 u_origin; uniform float u_px, u_fixed;
out vec4 v_col;
void main(){ vec4 c = u_vp*vec4(a_pos.xyz+u_origin, 1.); gl_Position = c; gl_PointSize = u_fixed > .5 ? a_pos.w*u_px : max(1.6, a_pos.w*u_px/c.w); v_col = a_col; }`;
const FS_POINTS = HEAD + `in vec4 v_col; out vec4 o;
void main(){ float d = length(gl_PointCoord-.5)*2.; float a = fall(1., 0., d); o = vec4(v_col.rgb*v_col.a*a*a, 1.); }`;

// A square facing the camera, big enough to hold a sphere (or the glow round one).
const VS_BILL = HEAD + `layout(location=0) in vec2 a_q;
uniform mat4 u_vp; uniform vec3 u_center, u_right, u_up; uniform float u_size;
out vec3 v_world; out vec2 v_q;
void main(){ v_q = a_q; v_world = u_center + (u_right*a_q.x + u_up*a_q.y)*u_size; gl_Position = u_vp*vec4(v_world, 1.); }`;

const FS_SPHERE = HEAD + NOISE + `
uniform mat4 u_vp; uniform vec3 u_eye, u_center, u_color, u_light;
uniform float u_radius, u_time, u_spin, u_seed, u_active, u_waiting, u_blip, u_tilt, u_scale, u_grown;
uniform vec3 u_color2; uniform vec4 u_p; // (what this world is like: see World in worlds.ts)
uniform int u_mode; // 0 a planet, 1 the sun, 2 a moon
in vec3 v_world; out vec4 o;
void main(){
  vec3 d = normalize(v_world-u_eye), oc = u_eye-u_center;
  float b = dot(oc, d), h = b*b-(dot(oc, oc)-u_radius*u_radius);
  if(h < 0.) discard;
  float t = -b-sqrt(h);
  if(t < 0.) discard;
  vec3 hit = u_eye+d*t, n = (hit-u_center)/u_radius;
  vec4 clip = u_vp*vec4(hit, 1.);
  gl_FragDepth = clip.z/clip.w*.5+.5;
  float mu = max(dot(n, -d), 0.);
  vec3 col;
  if(u_mode == 1){
    // The sun: plasma that folds over itself, grain on top, hotter where it wells up.
    float tt = u_time*.05;
    float warp = fbm(n*2.4+vec3(tt, 0., -tt));
    float plasma = fbm(n*4.2+warp*1.8+vec3(0., tt*1.6, 0.));
    float heat = plasma*.78+noise(n*24.+tt*9.)*.22;
    col = mix(vec3(.92,.26,.03), vec3(1.,.66,.2), smoothstep(.28,.6,heat));
    col = mix(col, vec3(1.,.95,.78), smoothstep(.6,.86,heat));
    col *= (1.55+u_active*.8)*(.6+.4*mu);
    col += vec3(1.,.5,.12)*pow(max(1.-mu, 0.), 2.4)*.9;
    col = mix(col, col*vec3(1.,.9,.75)+.15, u_waiting*(.5+.5*sin(u_time*5.))*.5);
  } else if(u_mode == 2){
    float lit = smoothstep(-.1,.45,dot(n, u_light));
    col = mix(vec3(.55), u_color, .55)*(.13+lit*1.05)*(.72+.28*noise(n*7.+u_seed))*(1.-.35*smoothstep(.55,.75,noise(n*3.5+u_seed*2.)));
    col = mix(col, vec3(1.6,.95,.25), u_waiting*(.55+.45*sin(u_time*6.)));
  } else {
    float ndl = dot(n, u_light), day = smoothstep(-.12,.28,ndl);
    // Into the planet's own frame: tipped over a little, and turning.
    float ct = cos(u_tilt), st = sin(u_tilt); vec3 q = vec3(n.x*ct-n.y*st, n.x*st+n.y*ct, n.z);
    float cs = cos(u_spin), ss = sin(u_spin); vec3 p = vec3(q.x*cs+q.z*ss, q.y, -q.x*ss+q.z*cs);
    vec3 sd = vec3(u_seed*13.1, u_seed*7.7, u_seed*3.3), ps = p*u_scale; // (ps: the same place, with its features finer or coarser)
    // A world you could live on. The lie of the land first: sea below a level, shallows by the shore, then lowland,
    // hills and mountains; green where it rains and desert where it doesn't (more of it the drier the world is); snow on
    // the peaks; ice from the poles as far down as this world has it; and cloud over all of it, drifting.
    float hgt = fbm(ps*2.1+sd), land = smoothstep(u_p.x, u_p.x+.035, hgt), high = smoothstep(u_p.x+.1, u_p.x+.27, hgt), lat = abs(p.y);
    float rain = fbm(ps*3.4-sd*1.7);
    float dry = smoothstep(.42,.68, u_p.w*.95+(1.-rain)*.55-high*.2)*fall(.78,.5,lat);
    vec3 deep = mix(vec3(.01,.035,.11), u_color2*.22, .4), shoal = mix(vec3(.05,.3,.38), u_color2, .3)*.8;
    vec3 sea = mix(deep, shoal, smoothstep(u_p.x-.1, u_p.x, hgt)*.8);
    vec3 green = mix(u_color*.36, mix(u_color, u_color2, .3)*.92+.04, fbm(ps*6.+sd));
    vec3 sand = mix(vec3(.62,.5,.33), u_color2, .28)*(.74+.3*noise(ps*9.+sd));
    vec3 ground = mix(mix(green, sand, dry), vec3(.36,.34,.33)*(.8+.3*noise(ps*14.)), high*.7);
    ground = mix(ground, vec3(.9,.93,.97), smoothstep(.72,.92, high+lat*.45-.08));
    vec3 base = mix(sea, ground, land);
    float cap = smoothstep(u_p.z, u_p.z+.1, lat+(hgt-.5)*.3);
    base = mix(base, vec3(.85,.9,.96), cap);
    float drift = fbm(ps*3.2+sd+vec3(u_time*.012,0.,0.));
    float cloud = smoothstep(u_p.y, u_p.y+.17, drift*.76+fbm(ps*7.+drift*2.+vec3(u_time*.02,0.,0.))*.24);
    base = mix(base, vec3(.93), cloud*.6);
    // Where people would be: green lowland under clear sky. And where the sun glints: open water.
    vec3 emis = vec3(0.);
    float settled = land*(1.-cloud*.6)*(1.-cap)*(1.-high*.65)*(1.-dry*.55), gloss = (1.-land)*(1.-cloud)*(1.-cap);
    col = base*(.085+max(ndl, 0.)*1.2+day*.2);
    col += vec3(1.,.95,.85)*pow(max(dot(n, normalize(u_light-d+1e-4)), 0.), 70.)*gloss*day*.9;
    // Its night side is lived on: a map of lights, thick in some places and empty in others, with routes that wander
    // between them. At camp it's dim and still. While its crew member works the lit places spread and brighten, and
    // light moves along the routes. From far off, where one light can't be told from the next, it's a soft glow instead
    // (fine: 1 close enough to see each light, 0 from far off; without it a small planet would glitter).
    float night = 1.-day;
    float fine = fall(.05, .012, length(fwidth(p)));
    float dens = smoothstep(mix(.47,.2,u_grown),mix(.75,.5,u_grown),fbm(p*2.6-sd))*settled;
    float grain = noise(p*46.+sd*3.)*.6+noise(p*93.-sd)*.4;
    float edge = mix(.66,.44,u_active);
    float lamps = smoothstep(edge, edge+.2, grain+dens*.34-.18)*dens;
    float way = noise(p*7.+sd), way2 = noise(p*11.-sd*2.);
    float route = (fall(.035,0.,abs(way-.5))+fall(.03,0.,abs(way2-.5))*.7)*smoothstep(.12,.5,dens+.15);
    float moving = pow(max(sin(p.x*17.+p.z*13.+way2*9.-u_time*2.6), 0.), 12.);
    float flicker = .72+.28*sin(u_time*(1.4+grain*5.)+grain*60.);
    vec3 lampCol = mix(vec3(1.,.8,.48), u_color, .42);
    float near = lamps*flicker*.95+route*(.12+.27*u_active), far = dens*(.2+.26*u_active);
    emis += lampCol*mix(far, near, fine)*(.3+u_active*1.05)*night;
    emis += (u_color+.25)*route*moving*u_active*1.3*fine*(.15+.85*night);
    // …and it has weather, that picks up with the work: an aurora round its poles, faint at camp and bright at work,
    // and lightning in its thickest cloud, now and then at camp and often at work.
    float curtain = smoothstep(.66,.75,lat)*fall(.9,.8,lat);
    float fold = .5+.5*sin(atan(p.z, p.x)*6.+u_time*1.1+noise(p*5.+vec3(0.,u_time*.25,0.))*6.);
    emis += mix(vec3(.2,1.,.55), u_color, .45)*curtain*fold*fold*(.05+u_active*.5)*(.04+.96*night);
    vec2 sc = vec2(atan(p.z, p.x)*5., p.y*8.);
    float strike = hash(vec3(floor(sc), floor(u_time*(2.5+u_active*5.))+u_seed));
    float flash = step(.994-u_active*.04, strike)*fall(.5,0.,length(fract(sc)-.5))*smoothstep(.55,.9,cloud);
    emis += vec3(.75,.85,1.)*flash*(.3+u_active*.9)*(.15+.85*night);
    // A tool call: a ring of light crosses it, starting from the side facing you.
    if(u_blip >= 0.){
      float ang = acos(clamp(dot(n, normalize(u_eye-u_center)), -1., 1.));
      emis += fall(.13,0.,abs(ang-u_blip*2.4))*(1.-u_blip)*(u_color+.45)*1.8;
    }
    // Its air: a rim in its colour, brighter on the day side and while at work; amber, and beating, while it waits on you.
    float rim = pow(max(1.-mu, 0.), 3.2);
    col += mix(u_color, vec3(.45,.65,1.), .3)*rim*(.28+.9*u_active)*(.22+.78*day);
    col += vec3(1.,.6,.14)*u_waiting*(.5+.5*sin(u_time*5.))*(rim*1.6+.07);
    col += emis;
  }
  o = vec4(max(col, vec3(0.)), 1.);
}`;

// The Artificer's: a station, not a world. It's worked out a pixel at a time like the spheres, but by stepping along the
// line of sight until it meets the shape (which is given as "how far is this point from the nearest part of it"): a hub
// on an axis, a ring of quarters turning round it on four spokes, a smaller ring turning the other way, and two solar
// wings on a mast. All in units of its radius, in its own frame (tipped over, so it's seen at an angle).
// At camp a few windows are lit and its beacons blink. At work more of it is lit, there's welding on its frame, and
// a tool call sends a light running round the ring.
const FS_STATION = HEAD + NOISE + `
uniform mat4 u_vp; uniform vec3 u_eye, u_center, u_color, u_light;
uniform float u_radius, u_time, u_spin, u_active, u_waiting, u_blip, u_tilt, u_grown;
uniform vec4 u_p; // how many spokes, a second ring or not, how big its ring is, how long its wings are
in vec3 v_world; out vec4 o;
const float TAU = 6.2831853;
mat2 turn(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float torus(vec3 p, float big, float small){ return length(vec2(length(p.xz)-big, p.y))-small; }
float box(vec3 p, vec3 b){ vec3 q = abs(p)-b; return length(max(q, 0.))+min(max(q.x, max(q.y, q.z)), 0.); }
float rod(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y))-vec2(r, h); return min(max(d.x, d.y), 0.)+length(max(d, 0.)); }
// How far p is from the station, and which part is nearest: 1 its frame (hub, spokes, mast), 2 the big ring, 3 the small ring, 4 a solar wing.
float station(vec3 p, out float part){
  float d = min(rod(p, .105, .6), length(p)-.21); part = 1.;
  d = min(d, rod(p-vec3(0., .72, 0.), .055, .13));                        // the collar ships dock at
  d = min(d, rod(p+vec3(0., .66, 0.), .02, .2));                          // an aerial
  vec3 q = p; q.xz = turn(u_spin*2.)*q.xz;
  float ring = max(torus(q, u_p.z, .07), abs(q.y)-.055);                  // (a tube, flattened a little top and bottom)
  if(ring < d){ d = ring; part = 2.; }
  float sector = TAU/u_p.x, a = mod(atan(q.z, q.x)+sector*.5, sector)-sector*.5, far = length(q.xz);
  float spoke = box(vec3(far*cos(a), q.y, far*sin(a))-vec3(u_p.z*.575, 0., 0.), vec3(u_p.z*.41, .017, .017));
  if(spoke < d){ d = spoke; part = 1.; }
  vec3 q2 = p+vec3(0., .36, 0.); q2.xz = turn(-u_spin*3.2)*q2.xz;
  float ring2 = u_p.y > .5 ? torus(q2, .46, .045) : 1e4;
  if(ring2 < d){ d = ring2; part = 3.; }
  vec3 w = p-vec3(0., .43, 0.);
  float mast = box(w, vec3(.52+u_p.w*2., .011, .011));
  if(mast < d){ d = mast; part = 1.; }
  float wing = box(vec3(abs(w.x)-(.52+u_p.w), w.y, w.z), vec3(u_p.w, .006, .15));
  if(wing < d){ d = wing; part = 4.; }
  return d;
}
void main(){
  // Into its own frame: tipped over, and its radius 1.
  float cx = cos(.55+u_tilt), sx = sin(.55+u_tilt), cz = cos(.35), sz = sin(.35);
  mat3 tip = mat3(1., 0., 0., 0., cx, sx, 0., -sx, cx)*mat3(cz, sz, 0., -sz, cz, 0., 0., 0., 1.);
  vec3 ro = tip*((u_eye-u_center)/u_radius), rd = tip*normalize(v_world-u_eye), L = tip*u_light;
  float b = dot(ro, rd), h = b*b-(dot(ro, ro)-1.6);                        // (a ball that holds all of it)
  if(h < 0.) discard;
  float t = max(-b-sqrt(h), 0.), end = -b+sqrt(h), part = 0., d = 1.;
  for(int i = 0; i < 64; i++){ d = station(ro+rd*t, part); if(d < .0022 || t > end) break; t += d*.9; }
  if(d >= .0022) discard;
  vec3 p = ro+rd*t; vec2 e = vec2(.0025, 0.); float skip;
  vec3 n = normalize(vec3(station(p+e.xyy, skip)-station(p-e.xyy, skip), station(p+e.yxy, skip)-station(p-e.yxy, skip), station(p+e.yyx, skip)-station(p-e.yyx, skip)));
  vec4 clip = u_vp*vec4(u_center+(transpose(tip)*p)*u_radius, 1.);
  gl_FragDepth = clip.z/clip.w*.5+.5;
  // Lit by the sun, in shadow where another part of it is in the way, darker in its corners.
  float lit = max(dot(n, L), 0.), shade = 1., s = .03;
  for(int i = 0; i < 16; i++){ float ds = station(p+L*s, skip); if(ds < .003){ shade = .16; break; } s += max(ds, .02); if(s > 2.) break; }
  float nook = .45+.55*clamp(station(p+n*.07, skip)/.07, 0., 1.);
  vec3 base, emis = vec3(0.); float gloss = .35;
  if(part < 1.5){        // its frame: plates, with a band in the Artificer's colour round the hub
    base = vec3(.5, .52, .56)*(.82+.18*step(.5, fract(p.y*13.)))*(.9+.1*noise(p*40.));
    base = mix(base, u_color*.8, step(abs(abs(p.y)-.36), .035)*step(length(p.xz), .12));
    // Welding, here and there on it, while there's work on.
    emis += vec3(.7, .85, 1.)*step(.9965-u_active*.0035, hash(floor(p*17.)+floor(u_time*10.)*7.31))*u_active*4.;
    // A beacon at each end of the axis; amber, and beating, while it waits on you.
    float tipLight = fall(.06, .0, length(p-vec3(0., .86, 0.)))+fall(.05, .0, length(p+vec3(0., .86, 0.)));
    emis += mix(vec3(1.), vec3(1., .6, .14), u_waiting)*tipLight*step(.72-u_waiting*.3, fract(u_time*(.7+u_waiting*1.6)))*3.;
    emis += vec3(1., .6, .14)*u_waiting*(.5+.5*sin(u_time*5.))*.12;
  } else if(part < 3.5){ // a ring: quarters, with two rows of windows; a few lit at camp, most of them at work
    bool big = part < 2.5;
    vec3 q = big ? p : p+vec3(0., .36, 0.); q.xz = turn(big ? u_spin*2. : -u_spin*3.2)*q.xz;
    float round = atan(q.z, q.x), across = atan(q.y, length(q.xz)-(big ? u_p.z : .46)), cells = big ? 46. : 28.;
    base = vec3(.58, .6, .64)*(.85+.15*step(.08, fract(round/TAU*cells*.5)));
    float cell = floor(round/TAU*cells), inCell = fract(round/TAU*cells);
    float pane = smoothstep(.18, .3, inCell)*fall(.82, .7, inCell)*fall(.3, .16, abs(abs(across)-(big ? .95 : 1.57)));
    float on = step(hash(vec3(cell, sign(across), big ? 3. : 7.)), .2+.22*u_grown+.58*u_active);
    emis += mix(vec3(1., .84, .55), u_color, .3)*pane*on*(.7+u_active*1.3)*(.85+.15*sin(u_time*2.+cell));
    emis += u_color*fall(.1, .03, abs(across))*(.25+.5*u_active);        // a line of its colour round the rim
    // Lights at four points of the big ring: red, blinking.
    if(big) emis += vec3(1., .12, .08)*fall(.05, .0, abs(mod(round+TAU/u_p.x*.5, TAU/u_p.x)-TAU/u_p.x*.5))*fall(.25, .1, abs(across))*step(.75, fract(u_time*.8))*3.;
    // A tool call: a light runs once round the ring.
    if(u_blip >= 0.) emis += (u_color+.5)*fall(.5, 0., abs(mod(round-u_blip*TAU+3.1415927, TAU)-3.1415927))*(1.-u_blip)*1.6;
  } else {               // a solar wing: dark cells that catch the sun
    vec3 w = p-vec3(0., .43, 0.);
    float cellLine = max(step(.94, fract(w.x*16.)), step(.92, fract(w.z*12.)));
    base = mix(vec3(.02, .035, .1), vec3(.25, .27, .32), cellLine); gloss = 1.3;
  }
  vec3 col = base*(.11+lit*shade*1.3)*nook;
  col += vec3(1., .96, .88)*pow(max(dot(reflect(rd, n), L), 0.), 36.)*gloss*shade;
  col += u_color*pow(max(1.-max(dot(n, -rd), 0.), 0.), 3.)*.08*(1.+u_active);  // a little of its colour on its edges, so it's still theirs from far off
  o = vec4(max(col+emis, vec3(0.)), 1.);
}`;

// A rock of a cluster being mined: a lump, not a ball, worked out like the station by stepping along the line of
// sight until it meets the shape (a ball pushed in and out by noise, so each rock is its own). It tumbles. Seams of ore
// run through it in the crew member's colour, and glow where they're being worked; the main rock carries the rig, whose
// lamps come on as the work picks up.
const FS_ROCK = HEAD + NOISE + `
uniform mat4 u_vp; uniform vec3 u_eye, u_center, u_color, u_light;
uniform float u_radius, u_time, u_spin, u_seed, u_active, u_waiting, u_blip, u_rig, u_rough, u_grown;
in vec3 v_world; out vec4 o;
float lump(vec3 p){
  float n = noise(p*1.6+u_seed)*.6+noise(p*3.7+u_seed*2.3)*.28+noise(p*8.+u_seed*3.1)*.12;
  return length(p)-(.62+(n-.5)*u_rough*1.5);
}
void main(){
  // Into the rock's own frame: its radius 1, and tumbling about an axis of its own.
  float a = u_spin, b = .6+u_seed*1.7, ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
  mat3 tumble = mat3(ca, 0., -sa, 0., 1., 0., sa, 0., ca)*mat3(1., 0., 0., 0., cb, sb, 0., -sb, cb);
  vec3 ro = tumble*((u_eye-u_center)/u_radius), rd = tumble*normalize(v_world-u_eye), L = tumble*u_light;
  float bb = dot(ro, rd), h = bb*bb-(dot(ro, ro)-1.);
  if(h < 0.) discard;
  float t = max(-bb-sqrt(h), 0.), end = -bb+sqrt(h), d = 1.;
  for(int i = 0; i < 44; i++){ d = lump(ro+rd*t); if(d < .004 || t > end) break; t += d*.6; }
  if(d >= .004) discard;
  vec3 p = ro+rd*t; vec2 e = vec2(.006, 0.);
  vec3 n = normalize(vec3(lump(p+e.xyy)-lump(p-e.xyy), lump(p+e.yxy)-lump(p-e.yxy), lump(p+e.yyx)-lump(p-e.yyx)));
  vec4 clip = u_vp*vec4(u_center+(transpose(tumble)*p)*u_radius, 1.);
  gl_FragDepth = clip.z/clip.w*.5+.5;
  float lit = max(dot(n, L), 0.), mu = max(dot(n, -rd), 0.);
  vec3 sd = vec3(u_seed*5.3, u_seed*2.9, u_seed*7.1);
  vec3 base = mix(vec3(.2,.185,.17), vec3(.42,.38,.32), noise(p*5.+sd))*(.8+.2*noise(p*19.));
  base *= 1.-.4*smoothstep(.56,.72,noise(p*3.1-sd));                             // pits
  float seam = pow(max(1.-abs(noise(p*5.5+sd)*2.-1.), 0.), 7.);                  // ore, in seams
  base = mix(base, u_color*.7, seam*.55);
  vec3 emis = u_color*seam*u_active*(.5+.5*sin(noise(p*4.+sd)*18.-u_time*2.4))*1.5; // …hot where it's being cut
  if(u_rig > .5){
    // The rig: lamps set out over one side of the main rock, a few lit at camp and most of them at work; and a beacon.
    vec2 uv = vec2(atan(p.z, p.x), asin(clamp(p.y/max(length(p), 1e-4), -1., 1.)))*9.;
    float site = smoothstep(.2,.7,dot(normalize(p), normalize(vec3(.5,.6,.6))));
    float on = step(hash(vec3(floor(uv), u_seed)), (.1+.2*u_grown+.5*u_active)*site);
    emis += vec3(1.,.84,.55)*fall(.3,.1,length(fract(uv)-.5))*on*(.8+u_active*1.3);
    emis += vec3(1.,.15,.1)*fall(.12,.0,length(normalize(p)-normalize(vec3(.5,.6,.6))))*step(.7, fract(u_time*.8))*3.;
  }
  if(u_blip >= 0.) emis += (u_color+.45)*fall(.13,0.,abs(acos(clamp(dot(normalize(transpose(tumble)*p), normalize(u_eye-u_center)), -1., 1.))-u_blip*2.4))*(1.-u_blip)*1.6;
  emis += vec3(1.,.6,.14)*u_waiting*(.5+.5*sin(u_time*5.))*(pow(max(1.-mu, 0.), 2.)*.9+.05);
  vec3 col = base*(.11+lit*1.3)+vec3(1.,.95,.88)*pow(max(dot(reflect(rd, n), L), 0.), 22.)*seam*.6;
  o = vec4(max(col+emis, vec3(0.)), 1.);
}`;

// The glow round a sphere: how near this pixel's line of sight passes to the centre, in radii. The front of
// the sphere is nearer than this square, so nothing of it shows across the disc itself.
const FS_HALO = HEAD + NOISE + `
uniform vec3 u_eye, u_center, u_color; uniform float u_radius, u_strength, u_falloff, u_ring, u_ringW, u_time, u_rays;
in vec3 v_world; in vec2 v_q; out vec4 o;
void main(){
  vec3 d = normalize(v_world-u_eye), oc = u_eye-u_center;
  float x = length(oc-d*dot(oc, d))/u_radius, g;
  if(u_ring > 0.) g = exp(-sq((x-u_ring)/u_ringW));
  else {
    g = exp(-max(x-1., 0.)*u_falloff);
    if(u_rays > 0.){ // the sun's corona: streamers that shift, and a wide soft light beyond them
      float ang = atan(v_q.y, v_q.x);
      float rays = fbm3(vec3(cos(ang)*2.2, sin(ang)*2.2, x*.7-u_time*.12))*fbm3(vec3(ang*5., u_time*.06, 3.));
      g = g*(.55+rays*2.6) + .2*exp(-max(x-1., 0.)*.5) + .05*exp(-max(x-1., 0.)*.12);
    }
  }
  g *= fall(1., .8, length(v_q)); // (fade out before the square's own edge)
  o = vec4(u_color*g*u_strength, 1.);
}`;

// The table the system sits on: bearings every thirty degrees, range rings, the rim and its ticks, and the sun's ring going out.
const VS_PLANE = HEAD + `layout(location=0) in vec2 a_q; uniform mat4 u_vp; uniform float u_size; out vec2 v_xz;
void main(){ v_xz = a_q*u_size; gl_Position = u_vp*vec4(v_xz.x, 0., v_xz.y, 1.); }`;
const FS_PLANE = HEAD + `
uniform float u_reach, u_ping, u_pingA; uniform vec3 u_sun;
in vec2 v_xz; out vec4 o;
float thin(float dist, float px){ return fall(px*1.3+1e-4, 0., dist); } // a line, a pixel or so wide however far off it is
void main(){
  float r = length(v_xz), a = atan(v_xz.y, v_xz.x), wr = fwidth(r);
  float g = thin(abs(r-u_reach), wr)*.55;
  float spoke = abs(fract(a/.5235988+.5)-.5)*.5235988*r;
  g += thin(spoke, wr)*.2*smoothstep(46.,80.,r)*fall(u_reach+2., u_reach-2., r);
  float tick = abs(fract(a/.0872665+.5)-.5)*.0872665*r;
  g += thin(tick, wr)*.4*smoothstep(u_reach+3., u_reach+3.6, r)*fall(u_reach+9.6, u_reach+9., r);
  g += thin(abs(fract(r/42.+.5)-.5)*42., wr)*.06*fall(u_reach, u_reach-12., r);
  vec3 col = vec3(.42,.52,.74)*g;
  float front = exp(-sq((r-u_ping)/(5.+u_ping*.02)));
  col += u_sun*(front*1.8 + exp(-sq((r-u_ping+16.)/24.))*.22*step(r, u_ping))*u_pingA;
  col += u_sun*(.12*exp(-r/80.)+.035*exp(-r/260.));                                   // the sun's light, pooled on the table under it
  col *= fall(u_reach*2.1, u_reach*1.05, r);
  o = vec4(col, 1.);
}`;

// A contour line, turned to where its planet is. The stretch behind the planet is its tail.
const VS_LINE = HEAD + `layout(location=0) in vec3 a_p; uniform mat4 u_vp; uniform float u_rot; out float v_u;
void main(){ float c = cos(u_rot), s = sin(u_rot); gl_Position = u_vp*vec4(a_p.x*c-a_p.y*s, 0., a_p.x*s+a_p.y*c, 1.); v_u = a_p.z; }`;
const FS_LINE = HEAD + `uniform vec3 u_color; uniform float u_alpha, u_tail; in float v_u; out vec4 o;
void main(){ o = vec4(u_color*(u_alpha+u_tail*sq(smoothstep(.7, 1., v_u))*1.8), 1.); }`;

// A giant's rings: a flat sheet round it, tipped as the planet is.
const VS_RING = HEAD + `layout(location=0) in vec2 a_q; uniform mat4 u_vp; uniform vec3 u_center; uniform float u_size, u_tilt; out vec2 v_q;
void main(){ v_q = a_q; float ct = cos(u_tilt), st = sin(u_tilt); vec3 flat3 = vec3(a_q.x, 0., a_q.y)*u_size;
  gl_Position = u_vp*vec4(u_center+vec3(flat3.x*ct, -flat3.x*st, flat3.z), 1.); }`;
const FS_RING = HEAD + NOISE + `uniform vec3 u_color, u_center; uniform float u_seed, u_active, u_in, u_out; in vec2 v_q; out vec4 o;
void main(){
  float r = length(v_q)*(u_out+.05); // in the planet's radii
  float a = smoothstep(u_in, u_in+.1, r)*fall(u_out, u_out-.15, r)*smoothstep(.02,.05,abs(r-mix(u_in, u_out, .52))); // (with a gap part-way out)
  a *= .35+.65*noise(vec3(r*26., u_seed, 0.));
  vec3 col = (u_color*.75+.2)*(.55+u_active*.5);
  o = vec4(col*a*.8, a*.6);
}`;

const FS_BRIGHT = HEAD + `uniform sampler2D u_tex; in vec2 v_uv; out vec4 o;
void main(){ vec3 c = texture(u_tex, v_uv).rgb; if(any(isnan(c)) || any(isinf(c))) c = vec3(0.); float l = max(c.r, max(c.g, c.b)); o = vec4(c*smoothstep(.62, 1.25, l), 1.); }`;
const FS_BLUR = HEAD + `uniform sampler2D u_tex; uniform vec2 u_dir; in vec2 v_uv; out vec4 o;
void main(){
  vec3 c = texture(u_tex, v_uv).rgb*.227;
  c += (texture(u_tex, v_uv+u_dir*1.385).rgb+texture(u_tex, v_uv-u_dir*1.385).rgb)*.316;
  c += (texture(u_tex, v_uv+u_dir*3.231).rgb+texture(u_tex, v_uv-u_dir*3.231).rgb)*.070;
  o = vec4(c, 1.);
}`;
const FS_FINAL = HEAD + NOISE + `uniform sampler2D u_scene, u_bloomA, u_bloomB; uniform float u_time; in vec2 v_uv; out vec4 o;
void main(){
  vec2 c = v_uv-.5; float r2 = dot(c, c);
  vec2 fringe = c*r2*.012;                                        // the lens: colours part a little toward the corners
  vec3 col = vec3(texture(u_scene, v_uv+fringe).r, texture(u_scene, v_uv).g, texture(u_scene, v_uv-fringe).b);
  col += texture(u_bloomA, v_uv).rgb*.85+texture(u_bloomB, v_uv).rgb*1.15;
  col = 1.-exp(-col*1.5);
  col = pow(col, vec3(.94));
  col *= 1.-r2*.5;
  col += (hash(vec3(gl_FragCoord.xy, fract(u_time)*60.))-.5)*.016;
  o = vec4(col, 1.);
}`;

// ---------- The drawing ----------
type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number; depth?: WebGLRenderbuffer };

const STARS = 1800;

export function createHd(canvas: HTMLCanvasElement): HdRenderer | null {
  let gl: WebGL2RenderingContext | null = null;
  try { gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" }) as WebGL2RenderingContext | null; } catch { gl = null; }
  if (!gl) return null;
  const g = gl;
  const float = !!g.getExtension("EXT_color_buffer_float"); // (without it the picture is kept in eight bits: the bloom is a little flatter)

  function program(vs: string, fs: string, uniforms: string[]): Program {
    const make = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src); g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(`Orbit HD: a shader didn't compile: ${g.getShaderInfoLog(s)}`);
      return s;
    };
    const p = g.createProgram()!;
    g.attachShader(p, make(g.VERTEX_SHADER, vs)); g.attachShader(p, make(g.FRAGMENT_SHADER, fs)); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(`Orbit HD: a program didn't link: ${g.getProgramInfoLog(p)}`);
    return { p, u: Object.fromEntries(uniforms.map((n) => [n, g.getUniformLocation(p, `u_${n}`)])) };
  }

  let P: Record<"sky" | "points" | "sphere" | "station" | "rock" | "halo" | "plane" | "line" | "ring" | "bright" | "blur" | "final", Program>;
  try {
    P = {
      sky: program(VS_SCREEN, FS_SKY, ["right", "up", "fwd", "tan", "shift"]),
      points: program(VS_POINTS, FS_POINTS, ["vp", "origin", "px", "fixed"]),
      sphere: program(VS_BILL, FS_SPHERE, ["vp", "center", "right", "up", "size", "eye", "color", "light", "radius", "time", "spin", "seed", "active", "waiting", "blip", "mode", "tilt", "scale", "color2", "p", "grown"]),
      station: program(VS_BILL, FS_STATION, ["vp", "center", "right", "up", "size", "eye", "color", "light", "radius", "time", "spin", "active", "waiting", "blip", "p", "tilt", "grown"]),
      rock: program(VS_BILL, FS_ROCK, ["vp", "center", "right", "up", "size", "eye", "color", "light", "radius", "time", "spin", "seed", "active", "waiting", "blip", "rig", "rough", "grown"]),
      halo: program(VS_BILL, FS_HALO, ["vp", "center", "right", "up", "size", "eye", "color", "radius", "strength", "falloff", "ring", "ringW", "time", "rays"]),
      plane: program(VS_PLANE, FS_PLANE, ["vp", "size", "reach", "ping", "pingA", "sun"]),
      line: program(VS_LINE, FS_LINE, ["vp", "rot", "color", "alpha", "tail"]),
      ring: program(VS_RING, FS_RING, ["vp", "center", "size", "color", "seed", "active", "tilt", "in", "out"]),
      bright: program(VS_SCREEN, FS_BRIGHT, ["tex"]),
      blur: program(VS_SCREEN, FS_BLUR, ["tex", "dir"]),
      final: program(VS_SCREEN, FS_FINAL, ["scene", "bloomA", "bloomB", "time"]),
    };
  } catch (e) { console.warn(e); return null; }

  // What's drawn with: a square, the stars, the points that change every frame, and (once they're known) the contour lines.
  const buffer = (data: Float32Array, usage: number = g.STATIC_DRAW) => { const b = g.createBuffer()!; g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, data, usage); return b; };
  const vao = (b: WebGLBuffer, sizes: number[]) => {
    const v = g.createVertexArray()!; g.bindVertexArray(v); g.bindBuffer(g.ARRAY_BUFFER, b);
    const stride = sizes.reduce((a, n) => a + n, 0) * 4; let at = 0;
    sizes.forEach((n, i) => { g.enableVertexAttribArray(i); g.vertexAttribPointer(i, n, g.FLOAT, false, stride, at); at += n * 4; });
    g.bindVertexArray(null); return v;
  };
  const empty = g.createVertexArray()!;
  const quad = vao(buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])), [2]);
  // The stars: scattered evenly over the whole sky, most of them faint, a few with a little colour. Always the same ones.
  let rnd = 20261116;
  const rand = () => { rnd = (Math.imul(rnd, 1664525) + 1013904223) | 0; return (rnd >>> 0) / 4294967296; };
  const stars = new Float32Array(STARS * 8);
  for (let i = 0; i < STARS; i++) {
    const y = rand() * 2 - 1, a = rand() * 2 * Math.PI, s = Math.sqrt(1 - y * y), bright = rand() ** 3, tint = rand();
    stars.set([s * Math.cos(a) * 4000, y * 4000, s * Math.sin(a) * 4000, 1.1 + bright * 2.4,
      tint < 0.12 ? 1 : 0.86, tint < 0.12 ? 0.78 : 0.9, tint < 0.12 ? 0.55 : tint > 0.85 ? 1.2 : 1, 0.4 + bright * 1.8], i * 8);
  }
  const starVao = vao(buffer(stars), [4, 4]);
  const liveBuf = g.createBuffer()!;
  const liveVao = vao(liveBuf, [4, 4]);
  let live = new Float32Array(8 * 256);
  let lineVaos: { vao: WebGLVertexArrayObject; buf: WebGLBuffer; n: number }[] = [];

  // What it's drawn into before it reaches the screen: the picture itself, and two smaller ones for the bloom.
  let scene: Target | null = null, bloom: Target[] = [];
  let W = 0, H = 0, DPR = 1;
  const target = (w: number, h: number, withDepth: boolean): Target => {
    const tex = g.createTexture()!; g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, float ? g.RGBA16F : g.RGBA8, w, h, 0, g.RGBA, float ? g.HALF_FLOAT : g.UNSIGNED_BYTE, null);
    for (const [k, val] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, k, val);
    const fb = g.createFramebuffer()!; g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    let depth: WebGLRenderbuffer | undefined;
    if (withDepth) {
      depth = g.createRenderbuffer()!; g.bindRenderbuffer(g.RENDERBUFFER, depth);
      g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT24, w, h);
      g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, depth);
    }
    return { fb, tex, w, h, depth };
  };
  const drop = (t: Target | null) => { if (!t) return; g.deleteFramebuffer(t.fb); g.deleteTexture(t.tex); if (t.depth) g.deleteRenderbuffer(t.depth); };
  const into = (t: Target | null) => { g.bindFramebuffer(g.FRAMEBUFFER, t ? t.fb : null); g.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height); };
  const use = (prog: Program) => { g.useProgram(prog.p); return prog.u; };
  const v3 = (loc: WebGLUniformLocation | null, v: Vec3) => g.uniform3f(loc, v[0], v[1], v[2]);

  return {
    resize(w, h, dpr) {
      const d = Math.min(dpr || 1, 1.5); // (sharper than this costs more than it shows)
      const pw = Math.max(2, Math.round(w * d)), ph = Math.max(2, Math.round(h * d));
      if (pw === W && ph === H) return;
      W = pw; H = ph; DPR = d; canvas.width = pw; canvas.height = ph;
      drop(scene); bloom.forEach(drop);
      scene = target(pw, ph, true);
      const half = [Math.max(1, pw >> 1), Math.max(1, ph >> 1)], eighth = [Math.max(1, pw >> 3), Math.max(1, ph >> 3)];
      bloom = [target(half[0], half[1], false), target(half[0], half[1], false), target(eighth[0], eighth[1], false), target(eighth[0], eighth[1], false)];
    },

    setLines(contours) {
      for (const l of lineVaos) { g.deleteVertexArray(l.vao); g.deleteBuffer(l.buf); }
      lineVaos = contours.map((pts) => {
        // Each point with how far round the line it is (0 at the planet, 1 back at it), and the first again to close it.
        const data = new Float32Array((pts.length + 1) * 3);
        for (let k = 0; k <= pts.length; k++) data.set([pts[k % pts.length][0], pts[k % pts.length][1], k / pts.length], k * 3);
        const buf = buffer(data);
        return { vao: vao(buf, [3]), buf, n: pts.length + 1 };
      });
    },

    draw(f) {
      if (!scene) return;
      const { cam } = f;
      const px = (H / 2) / cam.tanHalf; // screen pixels to one unit, one unit away
      into(scene);
      g.clearColor(0, 0, 0, 1); g.clearDepth(1); g.depthMask(true);
      g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);

      // 1. The sky, then the stars.
      g.disable(g.DEPTH_TEST); g.disable(g.BLEND); g.depthMask(false);
      let u = use(P.sky);
      v3(u.right, cam.right); v3(u.up, cam.up); v3(u.fwd, cam.fwd);
      g.uniform2f(u.tan, cam.tanHalf * cam.aspect, cam.tanHalf); g.uniform2f(u.shift, cam.shift[0], cam.shift[1]);
      g.bindVertexArray(empty); g.drawArrays(g.TRIANGLES, 0, 3);
      g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE);
      u = use(P.points);
      g.uniformMatrix4fv(u.vp, false, cam.viewProj); v3(u.origin, cam.eye); g.uniform1f(u.px, DPR); g.uniform1f(u.fixed, 1);
      g.bindVertexArray(starVao); g.drawArrays(g.POINTS, 0, STARS);

      // 2. The solid things.
      g.disable(g.BLEND); g.enable(g.DEPTH_TEST); g.depthFunc(g.LESS); g.depthMask(true);
      u = use(P.sphere);
      g.uniformMatrix4fv(u.vp, false, cam.viewProj); v3(u.eye, cam.eye); v3(u.right, cam.right); v3(u.up, cam.up); g.uniform1f(u.time, f.time);
      g.bindVertexArray(quad);
      const sphere = (o: { center: Vec3; radius: number; color: Vec3; mode: number; seed?: number; spin?: number; active?: number; waiting?: number; blip?: number; world?: HdPlanet }) => {
        v3(u.center, o.center); g.uniform1f(u.radius, o.radius); g.uniform1f(u.size, o.radius * 1.25); v3(u.color, o.color);
        const far = Math.hypot(...o.center) || 1;
        g.uniform3f(u.light, -o.center[0] / far, -o.center[1] / far, -o.center[2] / far); // the sun is in the middle: the light comes from there
        g.uniform1i(u.mode, o.mode); g.uniform1f(u.seed, o.seed ?? 0); g.uniform1f(u.spin, o.spin ?? 0);
        g.uniform1f(u.active, o.active ?? 0); g.uniform1f(u.waiting, o.waiting ?? 0); g.uniform1f(u.blip, o.blip ?? -1);
        const w = o.world;
        g.uniform1f(u.tilt, w?.tilt ?? 0); g.uniform1f(u.scale, w?.scale ?? 1); v3(u.color2, w?.color2 ?? o.color);
        g.uniform4f(u.p, w?.p[0] ?? 0, w?.p[1] ?? 0, w?.p[2] ?? 0, w?.p[3] ?? 0); g.uniform1f(u.grown, w?.grown ?? 0.3);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      };
      sphere({ center: [0, 0, 0], radius: f.sun.radius, color: SUN, mode: 1, active: f.sun.active, waiting: f.sun.waiting });
      for (const p of f.planets) {
        if (p.kind === 0) sphere({ center: p.pos, radius: p.radius, color: p.color, mode: 0, seed: p.seed, spin: p.spin, active: p.active, waiting: p.waiting, blip: p.blip, world: p });
        for (const m of p.moons) sphere({ center: m.pos, radius: m.radius, color: m.own ? OWN_MOON : p.color, mode: 2, seed: m.radius * 37, waiting: m.waiting ? 1 : 0 });
      }
      // The station (if the Artificer is in the crew).
      for (const p of f.planets) if (p.kind === 4) {
        const us = use(P.station), far = Math.hypot(...p.pos) || 1;
        g.uniformMatrix4fv(us.vp, false, cam.viewProj); v3(us.eye, cam.eye); v3(us.right, cam.right); v3(us.up, cam.up); g.uniform1f(us.time, f.time);
        const big = p.radius * 1.3; // (it's mostly empty space between its parts, so it's drawn a little larger than a world to read as the same size)
        v3(us.center, p.pos); g.uniform1f(us.radius, big); g.uniform1f(us.size, big * 1.35); v3(us.color, p.color);
        g.uniform3f(us.light, -p.pos[0] / far, -p.pos[1] / far, -p.pos[2] / far);
        g.uniform1f(us.spin, p.spin); g.uniform1f(us.active, p.active); g.uniform1f(us.waiting, p.waiting); g.uniform1f(us.blip, p.blip);
        g.uniform4f(us.p, p.p[0], p.p[1], p.p[2], p.p[3]); g.uniform1f(us.tilt, p.tilt - 0.41); g.uniform1f(us.grown, p.grown ?? 0.3); // (0.41, the usual tilt, is how it has always sat)
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      }

      // The rocks of a cluster (anyone's whose is one).
      for (const p of f.planets) if (p.kind === 5 && p.rocks) {
        const ur = use(P.rock);
        g.uniformMatrix4fv(ur.vp, false, cam.viewProj); v3(ur.eye, cam.eye); v3(ur.right, cam.right); v3(ur.up, cam.up); g.uniform1f(ur.time, f.time);
        v3(ur.color, p.color); g.uniform1f(ur.active, p.active); g.uniform1f(ur.waiting, p.waiting); g.uniform1f(ur.rough, p.rough ?? 0.26); g.uniform1f(ur.grown, p.grown ?? 0.3);
        for (const rock of p.rocks) {
          const far = Math.hypot(...rock.pos) || 1;
          v3(ur.center, rock.pos); g.uniform1f(ur.radius, rock.radius); g.uniform1f(ur.size, rock.radius * 1.2);
          g.uniform3f(ur.light, -rock.pos[0] / far, -rock.pos[1] / far, -rock.pos[2] / far);
          g.uniform1f(ur.spin, rock.turned); g.uniform1f(ur.seed, rock.seed); g.uniform1f(ur.rig, rock.rig ? 1 : 0); g.uniform1f(ur.blip, rock.rig ? p.blip : -1);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
        }
      }

      // 3. What glows, added on top (it's hidden by anything solid in front of it, and hides nothing itself).
      g.depthMask(false); g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE);
      u = use(P.plane);
      g.uniformMatrix4fv(u.vp, false, cam.viewProj); g.uniform1f(u.size, f.reach * 2.2); g.uniform1f(u.reach, f.reach);
      g.uniform1f(u.ping, f.ping.r); g.uniform1f(u.pingA, f.ping.a); v3(u.sun, SUN);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

      u = use(P.line);
      g.uniformMatrix4fv(u.vp, false, cam.viewProj);
      f.lines.forEach((l, i) => {
        const line = lineVaos[i];
        if (!line) return;
        const base: Vec3 = [0.42, 0.52, 0.72];
        g.uniform3f(u.color, base[0] + (l.color[0] - base[0]) * l.tone + SUN[0] * l.lit * 1.6, base[1] + (l.color[1] - base[1]) * l.tone + SUN[1] * l.lit * 1.6, base[2] + (l.color[2] - base[2]) * l.tone + SUN[2] * l.lit * 1.6);
        g.uniform1f(u.rot, l.rot); g.uniform1f(u.alpha, 0.68 + l.tone * 0.55 + l.lit); g.uniform1f(u.tail, l.tail ? 0.5 + l.tone : 0);
        g.bindVertexArray(line.vao); g.drawArrays(g.LINE_STRIP, 0, line.n);
      });

      // A world's rings, if it has them (see-through, so laid over what's behind them and not added).
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      u = use(P.ring);
      g.uniformMatrix4fv(u.vp, false, cam.viewProj); g.bindVertexArray(quad);
      for (const p of f.planets) if (p.ring) {
        v3(u.center, p.pos); g.uniform1f(u.size, p.radius * (p.ring.outer + 0.05)); v3(u.color, p.color2); g.uniform1f(u.seed, p.seed); g.uniform1f(u.active, p.active);
        g.uniform1f(u.tilt, p.tilt); g.uniform1f(u.in, p.ring.inner); g.uniform1f(u.out, p.ring.outer);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      }

      g.blendFunc(g.ONE, g.ONE);
      u = use(P.halo);
      g.uniformMatrix4fv(u.vp, false, cam.viewProj); v3(u.eye, cam.eye); v3(u.right, cam.right); v3(u.up, cam.up); g.uniform1f(u.time, f.time);
      const halo = (center: Vec3, radius: number, color: Vec3, strength: number, o: { falloff?: number; reach?: number; ring?: number; ringW?: number; rays?: number } = {}) => {
        v3(u.center, center); g.uniform1f(u.radius, radius); g.uniform1f(u.size, radius * (o.reach ?? 3)); v3(u.color, color);
        g.uniform1f(u.strength, strength); g.uniform1f(u.falloff, o.falloff ?? 4); g.uniform1f(u.ring, o.ring ?? 0); g.uniform1f(u.ringW, o.ringW ?? 0.1); g.uniform1f(u.rays, o.rays ?? 0);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      };
      halo([0, 0, 0], f.sun.radius, SUN, 0.82 + f.sun.active * 0.45, { falloff: 2.2, reach: 10, rays: 1 });
      for (const p of f.planets) {
        if (p.kind !== 0) halo(p.pos, p.radius * 0.5, p.color, 0.05 + p.active * 0.16, { falloff: 1.6, reach: 5 });    // a station or a cluster has no air: only the light it gives off
        else halo(p.pos, p.radius, p.color, (0.22 + p.active * 0.6) * p.air, { falloff: 5.5 / Math.sqrt(p.air), reach: 2.6 }); // its air
        if (p.waiting > 0) halo(p.pos, p.radius, [1, 0.6, 0.14], 0.35 + 0.35 * Math.sin(f.time * 5), { ring: 1.55, ringW: 0.05, reach: 2.2 }); // waiting on you: an amber ring, beating
        if (p.land >= 0) halo(p.pos, p.radius, p.color, 1.4 * (1 - p.land), { ring: 1 + p.land * 2.4, ringW: 0.09, reach: 4 });      // a quest lands
      }

      // The comets and the streams.
      if (f.points.length) {
        if (live.length < f.points.length * 8) live = new Float32Array(f.points.length * 16);
        f.points.forEach((pt, i) => live.set([pt.pos[0], pt.pos[1], pt.pos[2], pt.size, pt.color[0], pt.color[1], pt.color[2], pt.a], i * 8));
        g.bindBuffer(g.ARRAY_BUFFER, liveBuf); g.bufferData(g.ARRAY_BUFFER, live.subarray(0, f.points.length * 8), g.DYNAMIC_DRAW);
        u = use(P.points);
        g.uniformMatrix4fv(u.vp, false, cam.viewProj); g.uniform3f(u.origin, 0, 0, 0); g.uniform1f(u.px, px); g.uniform1f(u.fixed, 0);
        g.bindVertexArray(liveVao); g.drawArrays(g.POINTS, 0, f.points.length);
      }

      // 4. Its bloom: what's bright, made smaller and softened twice over, and laid back on the picture.
      g.disable(g.DEPTH_TEST); g.disable(g.BLEND); g.bindVertexArray(empty);
      const pass = (prog: Program, to: Target | null, from: WebGLTexture, dir?: [number, number]) => {
        into(to); const uu = use(prog);
        g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, from); g.uniform1i(uu.tex, 0);
        if (dir) g.uniform2f(uu.dir, dir[0], dir[1]);
        g.drawArrays(g.TRIANGLES, 0, 3);
      };
      const [a1, a2, b1, b2] = bloom;
      pass(P.bright, a1, scene.tex);
      pass(P.blur, a2, a1.tex, [1 / a1.w, 0]); pass(P.blur, a1, a2.tex, [0, 1 / a1.h]);
      pass(P.blur, b1, a1.tex, [1 / b1.w, 0]); pass(P.blur, b2, b1.tex, [0, 1 / b1.h]);
      pass(P.blur, b1, b2.tex, [1.6 / b1.w, 0]); pass(P.blur, b2, b1.tex, [0, 1.6 / b1.h]);
      into(null);
      u = use(P.final);
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, scene.tex); g.uniform1i(u.scene, 0);
      g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, a1.tex); g.uniform1i(u.bloomA, 1);
      g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D, b2.tex); g.uniform1i(u.bloomB, 2);
      g.uniform1f(u.time, f.time);
      g.drawArrays(g.TRIANGLES, 0, 3);
      g.activeTexture(g.TEXTURE0);
    },

    dispose() {
      drop(scene); bloom.forEach(drop); scene = null; bloom = [];
      for (const l of lineVaos) { g.deleteVertexArray(l.vao); g.deleteBuffer(l.buf); }
      lineVaos = [];
      for (const prog of Object.values(P)) g.deleteProgram(prog.p);
    },
  };
}
