//#region src/byte-array.ts
function e(e) {
	return e instanceof Int8Array || e instanceof Uint8Array || e instanceof Uint8ClampedArray;
}
//#endregion
//#region src/configuration/configuration-file.ts
var t = class {
	fileName;
	data;
	constructor(e, t) {
		this.fileName = e, this.data = t;
	}
}, n = { XmlResourceFiles: {
	log: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE logmap [\n<!ELEMENT logmap (log)+>\n<!ELEMENT log (#PCDATA)>\n<!ATTLIST log events CDATA #IMPLIED>\n<!ATTLIST log output CDATA #IMPLIED>\n<!ATTLIST log filename CDATA #IMPLIED>\n<!ATTLIST log generations CDATA #IMPLIED>\n<!ATTLIST log limit CDATA #IMPLIED>\n<!ATTLIST log format CDATA #IMPLIED>\n]>\n<logmap>\n  <log events=\"None\"/>\n  <log output=\"Debug\"/>\n  <log filename=\"Magick-%g.log\"/>\n  <log generations=\"3\"/>\n  <log limit=\"2000\"/>\n  <log format=\"%t %r %u %v %d %c[%p]: %m/%f/%l/%d\n  %e\"/>\n</logmap>\n",
	policy: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE policymap [\n<!ELEMENT policymap (policy)*>\n<!ATTLIST policymap xmlns CDATA #FIXED \"\">\n<!ELEMENT policy EMPTY>\n<!ATTLIST policy xmlns CDATA #FIXED \"\">\n<!ATTLIST policy domain NMTOKEN #REQUIRED>\n<!ATTLIST policy name NMTOKEN #IMPLIED>\n<!ATTLIST policy pattern CDATA #IMPLIED>\n<!ATTLIST policy rights NMTOKEN #IMPLIED>\n<!ATTLIST policy stealth NMTOKEN #IMPLIED>\n<!ATTLIST policy value CDATA #IMPLIED>\n]>\n<policymap>\n  <policy domain=\"cache\" name=\"shared-secret\" value=\"passphrase\"/>\n  <policy domain=\"coder\" rights=\"none\" pattern=\"EPHEMERAL\" />\n  <policy domain=\"coder\" rights=\"none\" pattern=\"MVG\" />\n  <policy domain=\"coder\" rights=\"none\" pattern=\"MSL\" />\n  <policy domain=\"path\" rights=\"none\" pattern=\"@*\" />\n  <policy domain=\"path\" rights=\"none\" pattern=\"|*\" />\n</policymap>\n"
} }, r = class e {
	constructor() {
		this.log = new t("log.xml", n.XmlResourceFiles.log), this.policy = new t("policy.xml", n.XmlResourceFiles.policy);
	}
	static default = new e();
	*all() {
		yield this.log, yield this.policy;
	}
	log;
	policy;
}, i = class {
	constructor(e, t, n) {
		this.format = e, this.name = t, this.value = n;
	}
	format;
	name;
	value;
}, a = class {
	format;
	constructor(e) {
		this.format = e;
	}
	createDefine(e, t) {
		return typeof t == "boolean" ? new i(this.format, e, t ? "true" : "false") : typeof t == "string" ? new i(this.format, e, t) : new i(this.format, e, t.toString());
	}
	hasValue(e) {
		return e != null;
	}
}, o = class e {
	_scaleX;
	_scaleY;
	_shearX;
	_shearY;
	_translateX;
	_translateY;
	constructor(e = 1, t = 1, n = 0, r = 0, i = 0, a = 0) {
		this._scaleX = e, this._scaleY = t, this._shearX = n, this._shearY = r, this._translateX = i, this._translateY = a;
	}
	get scaleX() {
		return this._scaleX;
	}
	get scaleY() {
		return this._scaleY;
	}
	get shearX() {
		return this._shearX;
	}
	get shearY() {
		return this._shearY;
	}
	get translateX() {
		return this._translateX;
	}
	get translateY() {
		return this._translateY;
	}
	draw(e) {
		e.affine(this._scaleX, this._scaleY, this._shearX, this._shearY, this._translateX, this._translateY);
	}
	reset() {
		this._scaleX = 1, this._scaleY = 1, this._shearX = 0, this._shearY = 0, this._translateX = 0, this._translateY = 0;
	}
	transformOrigin(t, n) {
		let r = new e();
		r._translateX = t, r._translateY = n, this.transform(r);
	}
	transformRotation(t) {
		let n = new e();
		n._scaleX = Math.cos(e.normalizeAngleToRadians(t)), n._scaleY = Math.cos(e.normalizeAngleToRadians(t)), n._shearX = -Math.sin(e.normalizeAngleToRadians(t)), n._shearY = Math.sin(e.normalizeAngleToRadians(t)), this.transform(n);
	}
	transformScale(t, n) {
		let r = new e();
		r._scaleX = t, r._scaleY = n, this.transform(r);
	}
	transformSkewX(t) {
		let n = new e();
		n._shearX = Math.tan(e.normalizeAngleToRadians(t)), this.transform(n);
	}
	transformSkewY(t) {
		let n = new e();
		n._shearY = Math.tan(e.normalizeAngleToRadians(t)), this.transform(n);
	}
	static normalizeAngleToRadians(e) {
		let t = e / 360, n = Math.round(t);
		return Math.abs(t - n) === .5 && n % 2 != 0 && (n = t > 0 ? n - 1 : n + 1), Math.PI * (e - n * 360) / 180;
	}
	transform(e) {
		let t = this._scaleX, n = this._scaleY, r = this._shearX, i = this._shearY, a = this._translateX, o = this._translateY;
		this._scaleX = t * e._scaleX + i * e._shearX, this._scaleY = r * e._shearY + n * e._scaleY, this._shearX = r * e._scaleX + n * e._shearX, this._shearY = t * e._shearY + i * e._scaleY, this._translateX = t * e._translateX + i * e._translateY + a, this._translateY = r * e._translateX + n * e._translateY + o;
	}
}, s = class {
	_color;
	constructor(e) {
		this._color = e;
	}
	get color() {
		return this._color;
	}
	draw(e) {
		e.borderColor(this._color);
	}
}, c = class {
	_x;
	_y;
	_paintMethod;
	constructor(e, t, n) {
		this._x = e, this._y = t, this._paintMethod = n;
	}
	get x() {
		return this._x;
	}
	get y() {
		return this._y;
	}
	get paintMethod() {
		return this._paintMethod;
	}
	draw(e) {
		e.color(this._x, this._y, this._paintMethod);
	}
}, l = class {
	_color;
	constructor(e) {
		this._color = e;
	}
	get color() {
		return this._color;
	}
	draw(e) {
		e.fillColor(this._color);
	}
}, u = class {
	_opacity;
	constructor(e) {
		this._opacity = e;
	}
	get opacity() {
		return this._opacity;
	}
	draw(e) {
		e.fillOpacity(this._opacity.toDouble() / 100);
	}
}, d = class {
	_fillRule;
	constructor(e) {
		this._fillRule = e;
	}
	get fillRule() {
		return this._fillRule;
	}
	draw(e) {
		e.fillRule(this._fillRule);
	}
}, f = class {
	_pointSize;
	constructor(e) {
		this._pointSize = e;
	}
	get pointSize() {
		return this._pointSize;
	}
	draw(e) {
		e.fontPointSize(this._pointSize);
	}
}, p = class {
	constructor(e, t) {
		this.eventType = e, this.message = t ?? "";
	}
	eventType;
	message;
}, ee = {
	Undefined: 0,
	Activate: 1,
	Associate: 2,
	Background: 3,
	Copy: 4,
	Deactivate: 5,
	Discrete: 6,
	Disassociate: 7,
	Extract: 8,
	Off: 9,
	On: 10,
	Opaque: 11,
	Remove: 12,
	Set: 13,
	Shape: 14,
	Transparent: 15,
	OffIfOpaque: 16
}, m = {
	Red: 0,
	Cyan: 0,
	Gray: 0,
	Green: 1,
	Magenta: 1,
	Blue: 2,
	Yellow: 2,
	Black: 3,
	Alpha: 4,
	Index: 5,
	Meta0: 10,
	Meta1: 11,
	Meta2: 12,
	Meta3: 13,
	Meta4: 14,
	Meta5: 15,
	Meta6: 16,
	Meta7: 17,
	Meta8: 18,
	Meta9: 19,
	Meta10: 20,
	Meta11: 21,
	Meta12: 22,
	Meta13: 23,
	Meta14: 24,
	Meta15: 25,
	Meta16: 26,
	Meta17: 27,
	Meta18: 28,
	Meta19: 29,
	Meta20: 30,
	Meta21: 31,
	Meta22: 32,
	Meta23: 33,
	Meta24: 34,
	Meta25: 35,
	Meta26: 36,
	Meta27: 37,
	Meta28: 38,
	Meta29: 39,
	Meta30: 40,
	Meta31: 41,
	Meta32: 42,
	Meta33: 43,
	Meta34: 44,
	Meta35: 45,
	Meta36: 46,
	Meta37: 47,
	Meta38: 48,
	Meta39: 49,
	Meta40: 50,
	Meta41: 51,
	Meta42: 52,
	Meta43: 53,
	Meta44: 54,
	Meta45: 55,
	Meta46: 56,
	Meta47: 57,
	Meta48: 58,
	Meta49: 59,
	Meta50: 60,
	Meta51: 61,
	Meta52: 62,
	Composite: 64
}, h = {
	Undefined: 0,
	Red: 1,
	Gray: 1,
	Cyan: 1,
	Green: 2,
	Magenta: 2,
	Blue: 4,
	Yellow: 4,
	Black: 8,
	Alpha: 16,
	Opacity: 16,
	Index: 32,
	Composite: 31,
	TrueAlpha: 256,
	get RGB() {
		return this.Red | this.Green | this.Blue;
	},
	get CMYK() {
		return this.Cyan | this.Magenta | this.Yellow | this.Black;
	},
	get CMYKA() {
		return this.Cyan | this.Magenta | this.Yellow | this.Black | this.Alpha;
	},
	Meta0: 1 << m.Meta0,
	Meta1: 1 << m.Meta1,
	Meta2: 1 << m.Meta2,
	Meta3: 1 << m.Meta3,
	Meta4: 1 << m.Meta4,
	Meta5: 1 << m.Meta5,
	Meta6: 1 << m.Meta6,
	Meta7: 1 << m.Meta7,
	Meta8: 1 << m.Meta8,
	Meta9: 1 << m.Meta9,
	Meta10: 1 << m.Meta10,
	Meta11: 1 << m.Meta11,
	Meta12: 1 << m.Meta12,
	Meta13: 1 << m.Meta13,
	Meta14: 1 << m.Meta14,
	Meta15: 1 << m.Meta15,
	Meta16: 1 << m.Meta16,
	Meta17: 1 << m.Meta17,
	Meta18: 1 << m.Meta18,
	Meta19: 1 << m.Meta19,
	Meta20: 1 << m.Meta20,
	Meta21: 1 << m.Meta21,
	All: 134217727
}, te = class {
	constructor(e, t, n, r) {
		this.red = e, this.green = t, this.blue = n, this.white = r;
	}
	red;
	green;
	blue;
	white;
}, g = {
	Undefined: 0,
	CMY: 1,
	CMYK: 2,
	Gray: 3,
	HCL: 4,
	HCLp: 5,
	HSB: 6,
	HSI: 7,
	HSL: 8,
	HSV: 9,
	HWB: 10,
	Lab: 11,
	LCH: 12,
	LCHab: 13,
	LCHuv: 14,
	Log: 15,
	LMS: 16,
	Luv: 17,
	OHTA: 18,
	Rec601YCbCr: 19,
	Rec709YCbCr: 20,
	RGB: 21,
	scRGB: 22,
	sRGB: 23,
	Transparent: 24,
	XyY: 25,
	XYZ: 26,
	YCbCr: 27,
	YCC: 28,
	YDbDr: 29,
	YIQ: 30,
	YPbPr: 31,
	YUV: 32,
	LinearGray: 33,
	Jzazbz: 34,
	DisplayP3: 35,
	Adobe98: 36,
	ProPhoto: 37,
	Oklab: 38,
	Oklch: 39,
	CAT02LMSC: 40
}, ne = {
	[g.Undefined]: "Undefined",
	[g.CMY]: "CMY",
	[g.CMYK]: "CMYK",
	[g.Gray]: "Gray",
	[g.HCL]: "HCL",
	[g.HCLp]: "HCLp",
	[g.HSB]: "HSB",
	[g.HSI]: "HSI",
	[g.HSL]: "HSL",
	[g.HSV]: "HSV",
	[g.HWB]: "HWB",
	[g.Lab]: "Lab",
	[g.LCH]: "LCH",
	[g.LCHab]: "LCHab",
	[g.LCHuv]: "LCHuv",
	[g.Log]: "Log",
	[g.LMS]: "LMS",
	[g.Luv]: "Luv",
	[g.OHTA]: "OHTA",
	[g.Rec601YCbCr]: "Rec601YCbCr",
	[g.Rec709YCbCr]: "Rec709YCbCr",
	[g.RGB]: "RGB",
	[g.scRGB]: "scRGB",
	[g.sRGB]: "sRGB",
	[g.Transparent]: "Transparent",
	[g.XyY]: "XyY",
	[g.XYZ]: "XYZ",
	[g.YCbCr]: "YCbCr",
	[g.YCC]: "YCC",
	[g.YDbDr]: "YDbDr",
	[g.YIQ]: "YIQ",
	[g.YPbPr]: "YPbPr",
	[g.YUV]: "YUV",
	[g.LinearGray]: "LinearGray",
	[g.Jzazbz]: "Jzazbz",
	[g.DisplayP3]: "DisplayP3",
	[g.Adobe98]: "Adobe98",
	[g.ProPhoto]: "ProPhoto",
	[g.Oklab]: "Oklab",
	[g.Oklch]: "Oklch",
	[g.CAT02LMSC]: "CAT02LMS"
}, _ = class {
	colorSpace = g.Undefined;
	copyright = null;
	description = null;
	manufacturer = null;
	model = null;
}, v = class {
	_data;
	_index;
	constructor(e) {
		this._data = e, this._index = 0, this.isLittleEndian = !1;
	}
	get index() {
		return this._index;
	}
	isLittleEndian;
	readLong() {
		return this.canRead(4) ? this.isLittleEndian ? this.readLongLSB() : this.readLongMSB() : null;
	}
	readString(e) {
		if (e == 0) return "";
		if (!this.canRead(e)) return null;
		let t = new TextDecoder("utf-8").decode(this._data.subarray(this._index, this._index + e)), n = t.indexOf("\0");
		return n != -1 && (t = t.substring(0, n)), this._index += e, t;
	}
	seek(e) {
		return e >= this._data.length ? !1 : (this._index = e, !0);
	}
	skip(e) {
		return this._index + e >= this._data.length ? !1 : (this._index += e, !0);
	}
	canRead(e) {
		return e > this._data.length ? !1 : this._index + e <= this._data.length;
	}
	readLongLSB() {
		let e = this._data[this._index];
		return e |= this._data[this._index + 1] << 8, e |= this._data[this._index + 2] << 16, e |= this._data[this._index + 3] << 24, this._index += 4, e;
	}
	readLongMSB() {
		let e = this._data[this._index] << 24;
		return e |= this._data[this._index + 1] << 16, e |= this._data[this._index + 2] << 8, e |= this._data[this._index + 3], this._index += 4, e;
	}
}, y = class e {
	_data = new _();
	_reader;
	constructor(e) {
		this._reader = new v(e);
	}
	static read(t) {
		let n = new e(t);
		return n.readColorSpace(), n.readTagTable(), n._data;
	}
	readColorSpace() {
		this._reader.seek(16);
		let e = this._reader.readString(4);
		e != null && (this._data.colorSpace = this.determineColorSpace(e.trimEnd()));
	}
	determineColorSpace(e) {
		switch (e) {
			case "CMY": return g.CMY;
			case "CMYK": return g.CMYK;
			case "GRAY": return g.Gray;
			case "HSL": return g.HSL;
			case "HSV": return g.HSV;
			case "Lab": return g.Lab;
			case "Luv": return g.Luv;
			case "RGB": return g.sRGB;
			case "XYZ": return g.XYZ;
			case "YCbr": return g.YCbCr;
			default: return g.Undefined;
		}
	}
	readTagTable() {
		if (!this._reader.seek(128)) return;
		let e = this._reader.readLong();
		if (e != null) for (let t = 0; t < e; t++) switch (this._reader.readLong()) {
			case 1668313716:
				this._data.copyright = this.readTag();
				break;
			case 1684370275:
				this._data.description = this.readTag();
				break;
			case 1684893284:
				this._data.manufacturer = this.readTag();
				break;
			case 1684890724:
				this._data.model = this.readTag();
				break;
			default:
				this._reader.skip(8);
				break;
		}
	}
	readTag() {
		let e = this._reader.readLong(), t = this._reader.readLong();
		if (e === null || t === null) return null;
		let n = this._reader.index;
		if (!this._reader.seek(e)) return null;
		let r = this.readTagValue(t);
		return this._reader.seek(n), r;
	}
	readTagValue(e) {
		switch (this._reader.readString(4)) {
			case "desc": return this.readTextDescriptionTypeValue();
			case "text": return this.readTextTypeValue(e);
			default: return null;
		}
	}
	readTextDescriptionTypeValue() {
		if (!this._reader.skip(4)) return null;
		let e = this._reader.readLong();
		return e == null ? null : this._reader.readString(e);
	}
	readTextTypeValue(e) {
		return this._reader.skip(4) ? this._reader.readString(e) : null;
	}
}, re = class {
	constructor(e, t) {
		this.name = e, this.data = t;
	}
	name;
	data;
}, b = class extends re {
	_data;
	constructor(e) {
		super("icc", e);
	}
	get colorSpace() {
		return this.initialize(), this._data.colorSpace;
	}
	get copyright() {
		return this.initialize(), this._data.copyright;
	}
	get description() {
		return this.initialize(), this._data.description;
	}
	get manufacturer() {
		return this.initialize(), this._data.manufacturer;
	}
	get model() {
		return this.initialize(), this._data.model;
	}
	initialize() {
		this._data ||= y.read(this.data);
	}
}, x = {
	HighRes: 0,
	Quantum: 1
}, ie = class e {
	constructor(e, t) {
		this.distortion = e, this.difference = t;
	}
	difference;
	distortion;
	static _create(t, n) {
		return new e(t, n);
	}
}, S = class {
	constructor(e) {
		this.metric = e;
	}
	metric;
	highlightColor;
	lowlightColor;
	masklightColor;
	_setArtifacts(e) {
		this.highlightColor !== void 0 && e.setArtifact("compare:highlight-color", this.highlightColor), this.lowlightColor !== void 0 && e.setArtifact("compare:lowlight-color", this.lowlightColor), this.masklightColor !== void 0 && e.setArtifact("compare:masklight-color", this.masklightColor);
	}
}, ae = {
	Undefined: 0,
	Alpha: 1,
	Atop: 2,
	Blend: 3,
	Blur: 4,
	Bumpmap: 5,
	ChangeMask: 6,
	Clear: 7,
	ColorBurn: 8,
	ColorDodge: 9,
	Colorize: 10,
	CopyBlack: 11,
	CopyBlue: 12,
	Copy: 13,
	CopyCyan: 14,
	CopyGreen: 15,
	CopyMagenta: 16,
	CopyAlpha: 17,
	CopyRed: 18,
	CopyYellow: 19,
	Darken: 20,
	DarkenIntensity: 21,
	Difference: 22,
	Displace: 23,
	Dissolve: 24,
	Distort: 25,
	DivideDst: 26,
	DivideSrc: 27,
	DstAtop: 28,
	Dst: 29,
	DstIn: 30,
	DstOut: 31,
	DstOver: 32,
	Exclusion: 33,
	HardLight: 34,
	HardMix: 35,
	Hue: 36,
	In: 37,
	Intensity: 38,
	Lighten: 39,
	LightenIntensity: 40,
	LinearBurn: 41,
	LinearDodge: 42,
	LinearLight: 43,
	Luminize: 44,
	Mathematics: 45,
	MinusDst: 46,
	MinusSrc: 47,
	Modulate: 48,
	ModulusAdd: 49,
	ModulusSubtract: 50,
	Multiply: 51,
	No: 52,
	Out: 53,
	Over: 54,
	Overlay: 55,
	PegtopLight: 56,
	PinLight: 57,
	Plus: 58,
	Replace: 59,
	Saturate: 60,
	Screen: 61,
	SoftLight: 62,
	SrcAtop: 63,
	Src: 64,
	SrcIn: 65,
	SrcOut: 66,
	SrcOver: 67,
	Threshold: 68,
	VividLight: 69,
	Xor: 70,
	Stereo: 71,
	Freeze: 72,
	Interpolate: 73,
	Negate: 74,
	Reflect: 75,
	SoftBurn: 76,
	SoftDodge: 77,
	Stamp: 78,
	RMSE: 79,
	SaliencyBlend: 80,
	SeamlessBlend: 81
}, oe = {
	Warning: 300,
	ResourceLimitWarning: 300,
	TypeWarning: 305,
	OptionWarning: 310,
	DelegateWarning: 315,
	MissingDelegateWarning: 320,
	CorruptImageWarning: 325,
	FileOpenWarning: 330,
	BlobWarning: 335,
	StreamWarning: 340,
	CacheWarning: 345,
	CoderWarning: 350,
	FilterWarning: 352,
	ModuleWarning: 355,
	DrawWarning: 360,
	ImageWarning: 365,
	WandWarning: 370,
	RandomWarning: 375,
	XServerWarning: 380,
	MonitorWarning: 385,
	RegistryWarning: 390,
	ConfigureWarning: 395,
	PolicyWarning: 399,
	Error: 400,
	ResourceLimitError: 400,
	TypeError: 405,
	OptionError: 410,
	DelegateError: 415,
	MissingDelegateError: 420,
	CorruptImageError: 425,
	FileOpenError: 430,
	BlobError: 435,
	StreamError: 440,
	CacheError: 445,
	CoderError: 450,
	FilterError: 452,
	ModuleError: 455,
	DrawError: 460,
	ImageError: 465,
	WandError: 470,
	RandomError: 475,
	XServerError: 480,
	MonitorError: 485,
	RegistryError: 490,
	ConfigureError: 495,
	PolicyError: 499
}, C = class extends Error {
	_relatedErrors = [];
	constructor(e, t = oe.Error) {
		super(e), this.severity = t;
	}
	severity;
	get relatedErrors() {
		return this._relatedErrors;
	}
	_setRelatedErrors(e) {
		this._relatedErrors = e;
	}
}, w = class {
	static get depth() {
		return V._api._Quantum_Depth_Get();
	}
	static get max() {
		return V._api._Quantum_Max_Get();
	}
};
//#endregion
//#region src/internal/native/string.ts
function T(e, t) {
	return e === 0 ? t ?? null : V._api.UTF8ToString(e);
}
function se(e, t) {
	let n = T(t);
	return e._MagickMemory_Relinquish(t), n;
}
function ce(e, t, n) {
	let r = e.lengthBytesUTF8(t) + 1, i = e._malloc(r);
	try {
		return e.stringToUTF8(t, i, r), n(i);
	} finally {
		e._free(i);
	}
}
function E(e, t) {
	return e === null ? t(0) : ce(V._api, e, t);
}
//#endregion
//#region src/magick-color.ts
var D = class e {
	constructor(e, t, n, r, i) {
		if (e !== void 0) if (typeof e == "string") {
			let t = 0;
			try {
				t = V._api._MagickColor_Create(), E(e, (e) => {
					if (V._api._MagickColor_Initialize(t, e) === 0) throw new C("invalid color specified");
					this.initialize(t);
				});
			} finally {
				V._api._free(t);
			}
		} else this.r = e, this.g = t ?? 0, this.b = n ?? 0, i === void 0 ? this.a = r ?? w.max : (this.k = r ?? 0, this.a = i, this.isCmyk = !0);
	}
	r = 0;
	g = 0;
	b = 0;
	a = 0;
	k = 0;
	isCmyk = !1;
	static _create(t) {
		let n = new e();
		return n.initialize(t), n;
	}
	fuzzyEquals(e, t) {
		return e == this ? !0 : this._use((n) => e._use((e) => V._api._MagickColor_FuzzyEquals(n, e, t._toQuantum()) === 1));
	}
	toShortString() {
		return this.a === w.max ? this.isCmyk ? `cmyka(${this.r},${this.g},${this.b},${this.k})` : `#${this.toHex(this.r)}${this.toHex(this.g)}${this.toHex(this.b)}` : this.toString();
	}
	toString() {
		return this.isCmyk ? `cmyka(${this.r},${this.g},${this.b},${this.k},${(this.a / w.max).toFixed(4)})` : `#${this.toHex(this.r)}${this.toHex(this.g)}${this.toHex(this.b)}${this.toHex(this.a)}`;
	}
	_use(e) {
		let t = 0;
		try {
			return t = V._api._MagickColor_Create(), V._api._MagickColor_Red_Set(t, this.r), V._api._MagickColor_Green_Set(t, this.g), V._api._MagickColor_Blue_Set(t, this.b), V._api._MagickColor_Alpha_Set(t, this.a), this.isCmyk ? (V._api._MagickColor_Black_Set(t, this.k), V._api._MagickColor_IsCMYK_Set(t, 1)) : V._api._MagickColor_IsCMYK_Set(t, 0), e(t);
		} finally {
			V._api._MagickColor_Dispose(t);
		}
	}
	initialize(e) {
		this.r = V._api._MagickColor_Red_Get(e), this.g = V._api._MagickColor_Green_Get(e), this.b = V._api._MagickColor_Blue_Get(e), this.a = V._api._MagickColor_Alpha_Get(e), this.isCmyk = V._api._MagickColor_IsCMYK_Get(e) === 1, this.isCmyk && (this.k = V._api._MagickColor_Black_Get(e));
	}
	toHex(e) {
		return e.toString(16).padStart(2, "0");
	}
}, le = /* @__PURE__ */ function(e) {
	return e[e.NoValue = 0] = "NoValue", e[e.PercentValue = 4096] = "PercentValue", e[e.IgnoreAspectRatio = 8192] = "IgnoreAspectRatio", e[e.Less = 16384] = "Less", e[e.Greater = 32768] = "Greater", e[e.FillArea = 65536] = "FillArea", e[e.LimitPixels = 131072] = "LimitPixels", e[e.AspectRatio = 1048576] = "AspectRatio", e;
}({}), O = class e {
	_includeXyInToString;
	_width = 0;
	_height = 0;
	_x = 0;
	_y = 0;
	_aspectRatio = !1;
	_fillArea = !1;
	_greater = !1;
	_isPercentage = !1;
	_ignoreAspectRatio = !1;
	_less = !1;
	_limitPixels = !1;
	constructor(e, t, n, r) {
		if (typeof e == "number") {
			if (n !== void 0 && r !== void 0 ? (this._width = n, this._height = r, this._x = e, this._y = t ?? 0, this._includeXyInToString = !0) : (this._width = e, this._height = t ?? this._width, this._x = 0, this._y = 0, this._includeXyInToString = !1), this._width < 0) throw new C("negative width is not allowed");
			if (this._height < 0) throw new C("negative height is not allowed");
		} else {
			this._includeXyInToString = e.indexOf("+") >= 0 || e.indexOf("-") >= 0;
			let t = V._api._MagickGeometry_Create();
			try {
				E(e, (n) => {
					let r = V._api._MagickGeometry_Initialize(t, n);
					if (r === le.NoValue) throw new C("invalid geometry specified");
					this.hasFlag(r, le.AspectRatio) ? this.initializeFromAspectRation(t, e) : this.initialize(t, r);
				});
			} finally {
				V._api._MagickGeometry_Dispose(t);
			}
		}
	}
	get aspectRatio() {
		return this._aspectRatio;
	}
	get fillArea() {
		return this._fillArea;
	}
	set fillArea(e) {
		this._fillArea = e;
	}
	get greater() {
		return this._greater;
	}
	set greater(e) {
		this._greater = e;
	}
	get height() {
		return this._height;
	}
	set height(e) {
		this._height = e;
	}
	get ignoreAspectRatio() {
		return this._ignoreAspectRatio;
	}
	set ignoreAspectRatio(e) {
		this._ignoreAspectRatio = e;
	}
	get isPercentage() {
		return this._isPercentage;
	}
	set isPercentage(e) {
		this._isPercentage = e;
	}
	get less() {
		return this._less;
	}
	set less(e) {
		this._less = e;
	}
	get limitPixels() {
		return this._limitPixels;
	}
	set limitPixels(e) {
		this._limitPixels = e;
	}
	get width() {
		return this._width;
	}
	set width(e) {
		this._width = e;
	}
	get x() {
		return this._x;
	}
	set x(e) {
		this._x = e;
	}
	get y() {
		return this._y;
	}
	set y(e) {
		this._y = e;
	}
	toString() {
		if (this._aspectRatio) return this._width + ":" + this._height;
		let e = "";
		return this._width == 0 && this._height == 0 ? e += "0x0" : (this._width > 0 && (e += this._width.toString()), this._height > 0 ? e += "x" + this._height.toString() : e += "x"), (this._x != 0 || this._y != 0 || this._includeXyInToString) && (this._x >= 0 && (e += "+"), e += this._x, this.y >= 0 && (e += "+"), e += this.y), this._fillArea && (e += "^"), this._greater && (e += ">"), this._isPercentage && (e += "%"), this._ignoreAspectRatio && (e += "!"), this._less && (e += "<"), this._limitPixels && (e += "@"), e;
	}
	static _fromRectangle(t) {
		if (t === 0) throw new C("unable to allocate memory");
		try {
			let n = V._api._MagickRectangle_Width_Get(t), r = V._api._MagickRectangle_Height_Get(t);
			return new e(V._api._MagickRectangle_X_Get(t), V._api._MagickRectangle_Y_Get(t), n, r);
		} finally {
			V._api._MagickRectangle_Dispose(t);
		}
	}
	_toRectangle(e) {
		let t = V._api._MagickRectangle_Create();
		if (t === 0) throw new C("unable to allocate memory");
		try {
			return V._api._MagickRectangle_Width_Set(t, this._width), V._api._MagickRectangle_Height_Set(t, this._height), V._api._MagickRectangle_X_Set(t, this._x), V._api._MagickRectangle_Y_Set(t, this._y), e(t);
		} finally {
			V._api._MagickRectangle_Dispose(t);
		}
	}
	initialize(e, t) {
		this._width = V._api._MagickGeometry_Width_Get(e), this._height = V._api._MagickGeometry_Height_Get(e), this._x = V._api._MagickGeometry_X_Get(e), this._y = V._api._MagickGeometry_Y_Get(e), this._ignoreAspectRatio = this.hasFlag(t, le.IgnoreAspectRatio), this._isPercentage = this.hasFlag(t, le.PercentValue), this._fillArea = this.hasFlag(t, le.FillArea), this._greater = this.hasFlag(t, le.Greater), this._less = this.hasFlag(t, le.Less), this._limitPixels = this.hasFlag(t, le.LimitPixels);
	}
	initializeFromAspectRation(e, t) {
		this._aspectRatio = !0;
		let n = t.split(":");
		this._width = this.parseNumber(n[0]), this._height = this.parseNumber(n[1]), this._x = V._api._MagickGeometry_X_Get(e), this._y = V._api._MagickGeometry_Y_Get(e);
	}
	parseNumber(e) {
		let t = 0;
		for (; t < e.length && !this.isNumber(e[t]);) t++;
		let n = t;
		for (; t < e.length && this.isNumber(e[t]);) t++;
		return parseInt(e.substr(n, t - n));
	}
	isNumber(e) {
		return e >= "0" && e <= "9";
	}
	hasFlag(e, t) {
		return (e & t) === t;
	}
}, ue = class e {
	constructor(e, t) {
		this.x = e, this.y = t ?? e;
	}
	x;
	y;
	static _create(t) {
		return t === 0 ? new e(0, 0) : new e(V._api._PointInfo_X_Get(t), V._api._PointInfo_Y_Get(t));
	}
}, de = class e {
	constructor(e) {
		this.area = V._api._ConnectedComponent_GetArea(e), this.centroid = ue._create(V._api._ConnectedComponent_GetCentroid(e)), this.color = D._create(V._api._ConnectedComponent_GetColor(e)), this.height = V._api._ConnectedComponent_GetHeight(e), this.id = V._api._ConnectedComponent_GetId(e), this.width = V._api._ConnectedComponent_GetWidth(e), this.x = V._api._ConnectedComponent_GetX(e), this.y = V._api._ConnectedComponent_GetY(e);
	}
	area;
	centroid;
	color;
	height;
	id;
	width;
	x;
	y;
	static _create(t, n) {
		let r = [];
		if (t === 0) return r;
		for (let i = 0; i < n; i++) {
			let n = V._api._ConnectedComponent_GetInstance(t, i);
			n === 0 || V._api._ConnectedComponent_GetArea(n) < 2 ** -52 || r.push(new e(n));
		}
		return r;
	}
	toGeometry() {
		return new O(this.x, this.y, this.width, this.height);
	}
}, fe = class {
	angleThreshold;
	areaThreshold;
	circularityThreshold;
	connectivity;
	diameterThreshold;
	eccentricityThreshold;
	majorAxisThreshold;
	meanColor;
	minorAxisThreshold;
	perimeterThreshold;
	constructor(e) {
		this.connectivity = e;
	}
	_setArtifacts(e) {
		this.angleThreshold !== void 0 && e.setArtifact("connected-components:angle-threshold", this.angleThreshold.toString()), this.areaThreshold !== void 0 && e.setArtifact("connected-components:area-threshold", this.areaThreshold.toString()), this.circularityThreshold !== void 0 && e.setArtifact("connected-components:circularity-threshold", this.circularityThreshold.toString()), this.diameterThreshold !== void 0 && e.setArtifact("connected-components:diameter-threshold", this.diameterThreshold.toString()), this.eccentricityThreshold !== void 0 && e.setArtifact("connected-components:eccentricity-threshold", this.eccentricityThreshold.toString()), this.majorAxisThreshold !== void 0 && e.setArtifact("connected-components:major-axis-threshold", this.majorAxisThreshold.toString()), this.meanColor !== void 0 && e.setArtifact("connected-components:mean-color", this.meanColor.toString()), this.minorAxisThreshold !== void 0 && e.setArtifact("connected-components:minor-axis-threshold", this.minorAxisThreshold.toString()), this.perimeterThreshold !== void 0 && e.setArtifact("connected-components:perimeter-threshold", this.perimeterThreshold.toString());
	}
}, pe = {
	Undefined: 0,
	PixelsPerInch: 1,
	PixelsPerCentimeter: 2
}, me = class e {
	constructor(e, t, n) {
		t === void 0 ? (this.x = e, this.y = e, this.units = pe.PixelsPerInch) : n === void 0 ? (this.x = e, this.y = e, this.units = t) : (this.x = e, this.y = t, this.units = n);
	}
	x;
	y;
	units;
	toString(t) {
		return t == this.units || t === pe.Undefined || t === void 0 ? e.toString(this.x, this.y, t ?? pe.Undefined) : this.units == pe.PixelsPerCentimeter && t == pe.PixelsPerInch ? e.toString(this.x * 2.54, this.y * 2.54, t) : e.toString(this.x / 2.54, this.y / 2.54, t);
	}
	static toString(e, t, n) {
		let r = `${e}x${t}`;
		switch (n) {
			case pe.PixelsPerCentimeter:
				r += "cm";
				break;
			case pe.PixelsPerInch:
				r += "inch";
				break;
		}
		return r;
	}
}, k = class e {
	static _disposeAfterExecution(t, n) {
		try {
			let r = n(t);
			return r instanceof Promise ? Promise.resolve(r).then((n) => (t.dispose(), e.checkResult(t, n), n)) : (t.dispose(), e.checkResult(t, r), r);
		} catch (e) {
			throw t.dispose(), e;
		}
	}
	static checkResult(e, t) {
		if (t === e) throw new C("The result of the function cannot be the instance that has been disposed.");
		return t;
	}
}, he = class {
	_pointer;
	_bytes;
	_func;
	constructor(e, t, n) {
		this._pointer = e, this._func = n, this._bytes = V._api.HEAPU8.subarray(e, e + t);
	}
	func(e) {
		return e._bytes === void 0 ? e._func(new Uint8Array()) : e._func(e._bytes);
	}
	dispose() {
		this._pointer = V._api._MagickMemory_Relinquish(this._pointer);
	}
}, ge = class {
	instance;
	type;
	constructor(e, t) {
		this.instance = V._api._malloc(e), this.type = t, V._api.setValue(this.instance, 0, this.type);
	}
	get ptr() {
		return this.instance;
	}
	get value() {
		return V._api.getValue(this.instance, this.type);
	}
}, _e = class e extends ge {
	constructor() {
		super(4, "i32");
	}
	static use(t) {
		let n = new e();
		try {
			return t(n);
		} finally {
			V._api._free(n.ptr);
		}
	}
}, A = class e {
	pointer;
	constructor(e) {
		this.pointer = e;
	}
	get ptr() {
		return this.pointer.ptr;
	}
	check(e, t) {
		return this.isError() ? t() : e();
	}
	static usePointer(t, n) {
		return _e.use((r) => {
			let i = t(r.ptr);
			return e.checkException(r, i, n);
		});
	}
	static use(t, n) {
		return _e.use((r) => {
			let i = t(new e(r));
			return e.checkException(r, i, n);
		});
	}
	static checkException(t, n, r) {
		if (!e.isRaised(t)) return n;
		let i = e.getErrorSeverity(t.value);
		return i >= oe.Error ? e.throw(t, i) : r === void 0 ? e.dispose(t) : r(e.createError(t.value, i)), n;
	}
	isError() {
		return e.isRaised(this.pointer) ? e.getErrorSeverity(this.pointer.value) >= oe.Error : !1;
	}
	static getErrorSeverity(e) {
		return V._api._MagickExceptionHelper_Severity(e);
	}
	static isRaised(e) {
		return e.value !== 0;
	}
	static throw(t, n) {
		let r = e.createError(t.value, n);
		throw e.dispose(t), r;
	}
	static createError(t, n) {
		let r = new C(e.getMessage(t), n), i = V._api._MagickExceptionHelper_RelatedCount(t);
		if (i === 0) return r;
		let a = [];
		for (let n = 0; n < i; n++) {
			let r = V._api._MagickExceptionHelper_Related(t, n), i = e.getErrorSeverity(r), o = e.createError(r, i);
			a.push(o);
		}
		return r._setRelatedErrors(a), r;
	}
	static getMessage(e) {
		let t = V._api._MagickExceptionHelper_Message(e), n = V._api._MagickExceptionHelper_Description(e), r = T(t, "Unknown error");
		return n !== 0 && (r += `(${V._api.UTF8ToString(n)})`), r;
	}
	static dispose(e) {
		V._api._MagickExceptionHelper_Dispose(e.value);
	}
}, ve = class {
	disposeMethod;
	instance;
	constructor(e, t) {
		this.instance = e, this.disposeMethod = t;
	}
	get _instance() {
		if (this.instance > 0) return this.instance;
		throw this.instance === -1 && this._instanceNotInitialized(), new C("instance is disposed");
	}
	set _instance(e) {
		this.disposeInstance(this.instance), this.instance = e;
	}
	dispose() {
		this.instance = this.disposeInstance(this.instance);
	}
	_instanceNotInitialized() {
		throw new C("instance is not initialized");
	}
	_setInstance(e, t) {
		return t.check(() => this.instance === 0 ? !1 : (this.dispose(), this.instance = e, !0), () => (this.disposeInstance(e), !0));
	}
	disposeInstance(e) {
		return e > 0 && (this.onDispose !== void 0 && this.onDispose(), this.disposeMethod(e)), 0;
	}
}, ye = class e {
	constructor(e, t, n, r, i, a, o) {
		this.ascent = e, this.descent = t, this.maxHorizontalAdvance = n, this.textHeight = r, this.textWidth = i, this.underlinePosition = a, this.underlineThickness = o;
	}
	ascent;
	descent;
	maxHorizontalAdvance;
	textHeight;
	textWidth;
	underlinePosition;
	underlineThickness;
	static _create(t) {
		if (t == 0) return null;
		try {
			return new e(V._api._TypeMetric_Ascent_Get(t), V._api._TypeMetric_Descent_Get(t), V._api._TypeMetric_MaxHorizontalAdvance_Get(t), V._api._TypeMetric_TextHeight_Get(t), V._api._TypeMetric_TextWidth_Get(t), V._api._TypeMetric_UnderlinePosition_Get(t), V._api._TypeMetric_UnderlineThickness_Get(t));
		} finally {
			V._api._TypeMetric_Dispose(t);
		}
	}
};
//#endregion
//#region src/internal/native/array.ts
function be(e, t) {
	if (e.byteLength === 0) throw new C("The specified array cannot be empty");
	let n = 0;
	try {
		return n = V._api._malloc(e.byteLength), V._api.HEAPU8.set(e, n), t(n);
	} finally {
		n !== 0 && V._api._free(n);
	}
}
function xe(e, t) {
	if (e.length === 0) throw new C("The specified array cannot be empty");
	let n = e.length * 8, r = 0;
	try {
		r = V._api._malloc(n);
		let i = new ArrayBuffer(n), a = new Float64Array(i);
		for (let t = 0; t < e.length; t++) a[t] = e[t];
		return V._api.HEAPU8.set(new Int8Array(i), r), t(r);
	} finally {
		r !== 0 && V._api._free(r);
	}
}
function Se(e, t) {
	if (e.byteLength === 0) throw new C("The specified array cannot be empty");
	let n = 0;
	try {
		return n = V._api._malloc(e.byteLength), V._api.HEAPU8.set(e, n), t(n);
	} finally {
		n !== 0 && V._api._free(n);
	}
}
//#endregion
//#region src/drawing/drawing-wand.ts
var Ce = class e extends ve {
	constructor(e) {
		let t = e.settings._drawing._use((t) => V._api._DrawingWand_Create(e._instance, t._instance)), n = V._api._DrawingWand_Dispose;
		super(t, n);
	}
	affine(e, t, n, r, i, a) {
		A.usePointer((o) => {
			V._api._DrawingWand_Affine(this._instance, e, t, n, r, i, a, o);
		});
	}
	borderColor(e) {
		A.usePointer((t) => {
			e._use((e) => {
				V._api._DrawingWand_BorderColor(this._instance, e, t);
			});
		});
	}
	color(e, t, n) {
		A.usePointer((r) => {
			V._api._DrawingWand_Color(this._instance, e, t, n, r);
		});
	}
	draw(e) {
		e.forEach((e) => {
			e.draw(this);
		}), A.usePointer((e) => {
			V._api._DrawingWand_Render(this._instance, e);
		});
	}
	fillColor(e) {
		A.usePointer((t) => {
			e._use((e) => {
				V._api._DrawingWand_FillColor(this._instance, e, t);
			});
		});
	}
	fillOpacity(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_FillOpacity(this._instance, e, t);
		});
	}
	fillRule(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_FillRule(this._instance, e, t);
		});
	}
	font(e) {
		A.usePointer((t) => {
			E(e, (e) => {
				V._api._DrawingWand_Font(this._instance, e, t);
			});
		});
	}
	fontPointSize(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_FontPointSize(this._instance, e, t);
		});
	}
	fontTypeMetrics(e, t) {
		return A.usePointer((n) => E(e, (e) => {
			let r = V._api._DrawingWand_FontTypeMetrics(this._instance, e, +!!t, n);
			return ye._create(r);
		}));
	}
	gravity(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_Gravity(this._instance, e, t);
		});
	}
	line(e, t, n, r) {
		A.usePointer((i) => {
			V._api._DrawingWand_Line(this._instance, e, t, n, r, i);
		});
	}
	pathFinish() {
		A.usePointer((e) => {
			V._api._DrawingWand_PathFinish(this._instance, e);
		});
	}
	pathLineToAbs(e, t) {
		A.usePointer((n) => {
			V._api._DrawingWand_PathLineToAbs(this._instance, e, t, n);
		});
	}
	pathLineToRel(e, t) {
		A.usePointer((n) => {
			V._api._DrawingWand_PathLineToRel(this._instance, e, t, n);
		});
	}
	pathMoveToAbs(e, t) {
		A.usePointer((n) => {
			V._api._DrawingWand_PathMoveToAbs(this._instance, e, t, n);
		});
	}
	pathMoveToRel(e, t) {
		A.usePointer((n) => {
			V._api._DrawingWand_PathMoveToRel(this._instance, e, t, n);
		});
	}
	pathStart() {
		A.usePointer((e) => {
			V._api._DrawingWand_PathStart(this._instance, e);
		});
	}
	point(e, t) {
		A.usePointer((n) => {
			V._api._DrawingWand_Point(this._instance, e, t, n);
		});
	}
	rectangle(e, t, n, r) {
		A.usePointer((i) => {
			V._api._DrawingWand_Rectangle(this._instance, e, t, n, r, i);
		});
	}
	roundRectangle(e, t, n, r, i, a) {
		A.usePointer((o) => {
			V._api._DrawingWand_RoundRectangle(this._instance, e, t, n, r, i, a, o);
		});
	}
	strokeColor(e) {
		A.usePointer((t) => {
			e._use((e) => {
				V._api._DrawingWand_StrokeColor(this._instance, e, t);
			});
		});
	}
	strokeDashArray(e) {
		A.usePointer((t) => {
			xe(e, (n) => {
				V._api._DrawingWand_StrokeDashArray(this._instance, n, e.length, t);
			});
		});
	}
	strokeDashOffset(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_StrokeDashOffset(this._instance, e, t);
		});
	}
	strokeWidth(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_StrokeWidth(this._instance, e, t);
		});
	}
	text(e, t, n) {
		A.usePointer((r) => {
			E(n, (n) => {
				V._api._DrawingWand_Text(this._instance, e, t, n, r);
			});
		});
	}
	textAlignment(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_TextAlignment(this._instance, e, t);
		});
	}
	textAntialias(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_TextAntialias(this._instance, +!!e, t);
		});
	}
	textDecoration(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_TextDecoration(this._instance, e, t);
		});
	}
	textInterlineSpacing(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_TextInterlineSpacing(this._instance, e, t);
		});
	}
	textInterwordspacing(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_TextInterwordSpacing(this._instance, e, t);
		});
	}
	textKerning(e) {
		A.usePointer((t) => {
			V._api._DrawingWand_TextKerning(this._instance, e, t);
		});
	}
	textUnderColor(e) {
		A.usePointer((t) => {
			e._use((e) => {
				V._api._DrawingWand_TextUnderColor(this._instance, e, t);
			});
		});
	}
	static _use(t, n) {
		let r = new e(t);
		return k._disposeAfterExecution(r, n);
	}
}, we = class e extends ge {
	constructor() {
		super(8, "double");
	}
	static use(t) {
		let n = new e();
		try {
			return t(n);
		} finally {
			V._api._free(n.ptr);
		}
	}
}, j = {
	Undefined: 0,
	Forget: 0,
	Northwest: 1,
	North: 2,
	Northeast: 3,
	West: 4,
	Center: 5,
	East: 6,
	Southwest: 7,
	South: 8,
	Southeast: 9
};
function* Te(e) {
	for (let t of e) switch (t) {
		case j.North:
			yield "north";
			break;
		case j.Northeast:
			yield "north", yield "east";
			break;
		case j.Northwest:
			yield "north", yield "west";
			break;
		case j.East:
			yield "east";
			break;
		case j.West:
			yield "west";
			break;
		case j.South:
			yield "south";
			break;
		case j.Southeast:
			yield "south", yield "east";
			break;
		case j.Southwest: yield "south", yield "west";
	}
}
function M(e) {
	switch (e) {
		case j.North: return "north";
		case j.Northeast: return "northeast";
		case j.Northwest: return "northwest";
		case j.East: return "east";
		case j.West: return "west";
		case j.South: return "south";
		case j.Southeast: return "southeast";
		case j.Southwest: return "southwest";
		case j.Center: return "center";
		default: return;
	}
}
//#endregion
//#region src/types/magick-error-info.ts
var N = class e {
	constructor(e, t, n) {
		this.meanErrorPerPixel = e, this.normalizedMeanError = t, this.normalizedMaximumError = n;
	}
	meanErrorPerPixel;
	normalizedMaximumError;
	normalizedMeanError;
	static _create(t) {
		return new e(V._api._MagickImage_MeanErrorPerPixel_Get(t._instance), V._api._MagickImage_NormalizedMeanError_Get(t._instance), V._api._MagickImage_NormalizedMaximumError_Get(t._instance));
	}
}, Ee = {
	Unknown: "UNKNOWN",
	ThreeFr: "3FR",
	ThreeG2: "3G2",
	ThreeGp: "3GP",
	A: "A",
	Aai: "AAI",
	Ai: "AI",
	APng: "APNG",
	Art: "ART",
	Arw: "ARW",
	Ashlar: "ASHLAR",
	Avci: "AVCI",
	Avi: "AVI",
	Avif: "AVIF",
	Avs: "AVS",
	B: "B",
	Bayer: "BAYER",
	Bayera: "BAYERA",
	Bgr: "BGR",
	Bgra: "BGRA",
	Bgro: "BGRO",
	Bmp: "BMP",
	Bmp2: "BMP2",
	Bmp3: "BMP3",
	Brf: "BRF",
	C: "C",
	Cal: "CAL",
	Cals: "CALS",
	Canvas: "CANVAS",
	Caption: "CAPTION",
	Cin: "CIN",
	Cip: "CIP",
	Clip: "CLIP",
	Cmyk: "CMYK",
	Cmyka: "CMYKA",
	Cr2: "CR2",
	Cr3: "CR3",
	Crw: "CRW",
	Cube: "CUBE",
	Cur: "CUR",
	Cut: "CUT",
	Data: "DATA",
	Dcm: "DCM",
	Dcr: "DCR",
	Dcraw: "DCRAW",
	Dcx: "DCX",
	Dds: "DDS",
	Dfont: "DFONT",
	Dng: "DNG",
	Dpx: "DPX",
	Dxt1: "DXT1",
	Dxt5: "DXT5",
	Epdf: "EPDF",
	Epi: "EPI",
	Eps: "EPS",
	Eps2: "EPS2",
	Eps3: "EPS3",
	Epsf: "EPSF",
	Epsi: "EPSI",
	Ept: "EPT",
	Ept2: "EPT2",
	Ept3: "EPT3",
	Erf: "ERF",
	Exr: "EXR",
	Farbfeld: "FARBFELD",
	Fax: "FAX",
	Ff: "FF",
	Fff: "FFF",
	File: "FILE",
	Fits: "FITS",
	Fl32: "FL32",
	Flv: "FLV",
	Fractal: "FRACTAL",
	Ftp: "FTP",
	Fts: "FTS",
	Ftxt: "FTXT",
	G: "G",
	G3: "G3",
	G4: "G4",
	Gif: "GIF",
	Gif87: "GIF87",
	Gradient: "GRADIENT",
	Gray: "GRAY",
	Graya: "GRAYA",
	Group4: "GROUP4",
	Hald: "HALD",
	Hdr: "HDR",
	Heic: "HEIC",
	Heif: "HEIF",
	Histogram: "HISTOGRAM",
	Hrz: "HRZ",
	Htm: "HTM",
	Html: "HTML",
	Http: "HTTP",
	Https: "HTTPS",
	Icb: "ICB",
	Ico: "ICO",
	Icon: "ICON",
	Icn: "ICN",
	Iiq: "IIQ",
	Info: "INFO",
	Inline: "INLINE",
	Ipl: "IPL",
	Isobrl: "ISOBRL",
	Isobrl6: "ISOBRL6",
	J2c: "J2C",
	J2k: "J2K",
	Jng: "JNG",
	Jnx: "JNX",
	Jp2: "JP2",
	Jpc: "JPC",
	Jpe: "JPE",
	Jpeg: "JPEG",
	Jpg: "JPG",
	Jpm: "JPM",
	Jps: "JPS",
	Jpt: "JPT",
	Json: "JSON",
	Jxl: "JXL",
	K: "K",
	K25: "K25",
	Kdc: "KDC",
	Label: "LABEL",
	M: "M",
	M2v: "M2V",
	M4v: "M4V",
	Mac: "MAC",
	Map: "MAP",
	Mask: "MASK",
	Mat: "MAT",
	Matte: "MATTE",
	Mdc: "MDC",
	Mef: "MEF",
	Miff: "MIFF",
	Mkv: "MKV",
	Mng: "MNG",
	Mono: "MONO",
	Mov: "MOV",
	Mos: "MOS",
	Mp4: "MP4",
	Mpc: "MPC",
	Mpeg: "MPEG",
	Mpg: "MPG",
	Mpo: "MPO",
	Mrw: "MRW",
	Msl: "MSL",
	Msvg: "MSVG",
	Mtv: "MTV",
	Mvg: "MVG",
	Nef: "NEF",
	Nrw: "NRW",
	Null: "NULL",
	O: "O",
	Ora: "ORA",
	Orf: "ORF",
	Otb: "OTB",
	Otf: "OTF",
	Pal: "PAL",
	Palm: "PALM",
	Pam: "PAM",
	Pango: "PANGO",
	Pattern: "PATTERN",
	Pbm: "PBM",
	Pcd: "PCD",
	Pcds: "PCDS",
	Pcl: "PCL",
	Pct: "PCT",
	Pcx: "PCX",
	Pdb: "PDB",
	Pdf: "PDF",
	Pdfa: "PDFA",
	Pef: "PEF",
	Pes: "PES",
	Pfa: "PFA",
	Pfb: "PFB",
	Pfm: "PFM",
	Pgm: "PGM",
	Pgx: "PGX",
	Phm: "PHM",
	Picon: "PICON",
	Pict: "PICT",
	Pix: "PIX",
	Pjpeg: "PJPEG",
	Plasma: "PLASMA",
	Png: "PNG",
	Png00: "PNG00",
	Png24: "PNG24",
	Png32: "PNG32",
	Png48: "PNG48",
	Png64: "PNG64",
	Png8: "PNG8",
	Pnm: "PNM",
	Pocketmod: "POCKETMOD",
	Ppm: "PPM",
	Ps: "PS",
	Ps2: "PS2",
	Ps3: "PS3",
	Psb: "PSB",
	Psd: "PSD",
	Ptif: "PTIF",
	Pwp: "PWP",
	Qoi: "QOI",
	R: "R",
	RadialGradient: "RADIAL-GRADIENT",
	Raf: "RAF",
	Ras: "RAS",
	Raw: "RAW",
	Rgb: "RGB",
	Rgb565: "RGB565",
	Rgba: "RGBA",
	Rgbo: "RGBO",
	Rgf: "RGF",
	Rla: "RLA",
	Rle: "RLE",
	Rmf: "RMF",
	Rw2: "RW2",
	Rwl: "RWL",
	Scr: "SCR",
	Screenshot: "SCREENSHOT",
	Sct: "SCT",
	Sf3: "SF3",
	Sfw: "SFW",
	Sgi: "SGI",
	Shtml: "SHTML",
	Six: "SIX",
	Sixel: "SIXEL",
	SparseColor: "SPARSE-COLOR",
	Sr2: "SR2",
	Srf: "SRF",
	Srw: "SRW",
	Stegano: "STEGANO",
	Sti: "STI",
	StrImg: "STRIMG",
	Sun: "SUN",
	Svg: "SVG",
	Svgz: "SVGZ",
	Text: "TEXT",
	Tga: "TGA",
	Thumbnail: "THUMBNAIL",
	Tif: "TIF",
	Tiff: "TIFF",
	Tiff64: "TIFF64",
	Tile: "TILE",
	Tim: "TIM",
	Tm2: "TM2",
	Ttc: "TTC",
	Ttf: "TTF",
	Txt: "TXT",
	Ubrl: "UBRL",
	Ubrl6: "UBRL6",
	Uil: "UIL",
	Uyvy: "UYVY",
	Vda: "VDA",
	Vicar: "VICAR",
	Vid: "VID",
	Viff: "VIFF",
	Vips: "VIPS",
	Vst: "VST",
	WebM: "WEBM",
	WebP: "WEBP",
	Wbmp: "WBMP",
	Wmv: "WMV",
	Wpg: "WPG",
	X3f: "X3F",
	Xbm: "XBM",
	Xc: "XC",
	Xcf: "XCF",
	Xpm: "XPM",
	Xps: "XPS",
	Xv: "XV",
	Y: "Y",
	Yaml: "YAML",
	Ycbcr: "YCBCR",
	Ycbcra: "YCBCRA",
	Yuv: "YUV"
}, De = {
	Undefined: 0,
	Coalesce: 1,
	CompareAny: 2,
	CompareClear: 3,
	CompareOverlay: 4,
	Dispose: 5,
	Optimize: 6,
	OptimizeImage: 7,
	OptimizePlus: 8,
	OptimizeTrans: 9,
	RemoveDups: 10,
	RemoveZero: 11,
	Composite: 12,
	Merge: 13,
	Flatten: 14,
	Mosaic: 15,
	Trimbounds: 16
}, P = class extends ve {
	constructor(e) {
		let t = V._api._DrawingSettings_Create(), n = V._api._DrawingSettings_Dispose;
		super(t, n);
		let r = e.affine;
		r !== void 0 && V._api._DrawingSettings_SetAffine(this._instance, r.scaleX, r.scaleY, r.shearX, r.shearY, r.translateX, r.translateY), e.borderColor !== void 0 && e.borderColor._use((e) => {
			V._api._DrawingSettings_BorderColor_Set(this._instance, e);
		}), e.fillColor !== void 0 && e.fillColor._use((e) => {
			V._api._DrawingSettings_FillColor_Set(this._instance, e);
		}), e.fillRule !== void 0 && V._api._DrawingSettings_FillRule_Set(this._instance, e.fillRule), e.font !== void 0 && E($e._getFontFileName(e.font), (e) => {
			V._api._DrawingSettings_Font_Set(this._instance, e);
		}), e.fontPointsize !== void 0 && V._api._DrawingSettings_FontPointsize_Set(this._instance, e.fontPointsize), e.strokeColor !== void 0 && e.strokeColor._use((e) => {
			V._api._DrawingSettings_StrokeColor_Set(this._instance, e);
		});
		let i = e.strokeDashArray;
		i !== void 0 && xe(i, (e) => {
			V._api._DrawingSettings_SetStrokeDashArray(this._instance, e, i.length);
		}), e.strokeDashOffset !== void 0 && V._api._DrawingSettings_StrokeDashOffset_Set(this._instance, e.strokeDashOffset), e.strokeWidth !== void 0 && V._api._DrawingSettings_StrokeWidth_Set(this._instance, e.strokeWidth), e.textAntiAlias !== void 0 && V._api._DrawingSettings_TextAntiAlias_Set(this._instance, +!!e.textAntiAlias), e.textGravity !== void 0 && V._api._DrawingSettings_TextGravity_Set(this._instance, e.textGravity), e.textKerning !== void 0 && V._api._DrawingSettings_TextKerning_Set(this._instance, e.textKerning), e.textUnderColor !== void 0 && e.textUnderColor._use((e) => {
			V._api._DrawingSettings_TextUnderColor_Set(this._instance, e);
		});
	}
	setFillColor(e) {
		e === void 0 ? V._api._DrawingSettings_FillColor_Set(this._instance, 0) : e._use((e) => {
			V._api._DrawingSettings_FillColor_Set(this._instance, e);
		});
	}
	setFillPattern(e) {
		A.usePointer((t) => {
			e === void 0 ? V._api._DrawingSettings_SetFillPattern(this._instance, 0, t) : V._api._DrawingSettings_SetFillPattern(this._instance, e._instance, t);
		});
	}
}, Oe = class {
	affine;
	borderColor;
	backgroundColor;
	fillColor;
	fillRule;
	font;
	fontPointsize;
	strokeColor;
	strokeDashArray;
	strokeDashOffset;
	strokeWidth;
	textAntiAlias;
	textGravity;
	textKerning;
	textUnderColor;
	_use(e) {
		let t = new P(this);
		return k._disposeAfterExecution(t, e);
	}
}, ke = {
	Undefined: 0,
	EvenOdd: 1,
	NonZero: 2
}, F = class extends ve {
	constructor(e) {
		let t = V._api._MagickSettings_Create(), n = V._api._MagickSettings_Dispose;
		super(t, n), e._colorFuzz !== void 0 && V._api._MagickSettings_SetColorFuzz(this._instance, e._colorFuzz), e._fileName !== void 0 && E(e._fileName, (e) => {
			V._api._MagickSettings_SetFileName(this._instance, e);
		}), e._ping && V._api._MagickSettings_SetPing(this._instance, 1), e._quality !== void 0 && V._api._MagickSettings_SetQuality(this._instance, e._quality), e.antiAlias !== void 0 && V._api._MagickSettings_AntiAlias_Set(this._instance, +!!e.antiAlias), e.backgroundColor !== void 0 && e.backgroundColor._use((e) => {
			V._api._MagickSettings_BackgroundColor_Set(this._instance, e);
		}), e.colorSpace !== void 0 && V._api._MagickSettings_ColorSpace_Set(this._instance, e.colorSpace), e.colorType !== void 0 && V._api._MagickSettings_ColorType_Set(this._instance, e.colorType), e.compression !== void 0 && V._api._MagickSettings_Compression_Set(this._instance, e.compression), e.debug !== void 0 && V._api._MagickSettings_Debug_Set(this._instance, +!!e.debug), e.density !== void 0 && E(e.density.toString(), (e) => {
			V._api._MagickSettings_Density_Set(this._instance, e);
		}), e.depth !== void 0 && V._api._MagickSettings_Depth_Set(this._instance, e.depth), e.endian !== void 0 && V._api._MagickSettings_Endian_Set(this._instance, e.endian), e.fillColor !== void 0 && this.setOption("fill", e.fillColor.toString()), e.font !== void 0 && E($e._getFontFileName(e.font), (e) => {
			V._api._MagickSettings_SetFont(this._instance, e);
		}), e.fontPointsize !== void 0 && V._api._MagickSettings_FontPointsize_Set(this._instance, e.fontPointsize), e.format !== void 0 && E(e.format, (e) => {
			V._api._MagickSettings_Format_Set(this._instance, e);
		}), e.interlace !== void 0 && V._api._MagickSettings_Interlace_Set(this._instance, e.interlace), e.page !== void 0 && E(e.page.toString(), (e) => {
			V._api._MagickSettings_SetPage(this._instance, e);
		}), e.strokeColor !== void 0 && this.setOption("stroke", e.strokeColor.toString()), e.strokeWidth !== void 0 && this.setOption("strokeWidth", e.strokeWidth.toString()), e.textInterlineSpacing !== void 0 && this.setOption("interline-spacing", e.textInterlineSpacing.toString());
		for (let t in e._options) this.setOption(t, e._options[t]);
	}
	setOption(e, t) {
		E(e, (e) => {
			E(t, (t) => {
				V._api._MagickSettings_SetOption(this._instance, e, t);
			});
		});
	}
}, Ae = class e {
	_colorFuzz;
	_drawing = new Oe();
	_fileName;
	_onArtifact;
	_options = {};
	_ping = !1;
	_quality;
	get affine() {
		return this._drawing.affine;
	}
	set affine(e) {
		this._drawing.affine = e;
	}
	antiAlias;
	backgroundColor;
	get borderColor() {
		return this._drawing.borderColor;
	}
	set borderColor(e) {
		this._drawing.borderColor = e;
	}
	colorSpace;
	colorType;
	compression;
	debug;
	density;
	depth;
	endian;
	get fillColor() {
		return this._drawing.fillColor;
	}
	set fillColor(e) {
		this.setDefineAndArtifact("fill", e?.toString()), this._drawing.fillColor = e;
	}
	get fillRule() {
		return this._drawing.fillRule ?? ke.Undefined;
	}
	set fillRule(e) {
		this._drawing.fillRule = e;
	}
	get font() {
		return this._drawing.font;
	}
	set font(e) {
		this._drawing.font = e;
	}
	get fontPointsize() {
		return this._drawing.fontPointsize;
	}
	set fontPointsize(e) {
		this._drawing.fontPointsize = e;
	}
	format;
	interlace;
	page;
	get strokeColor() {
		return this._drawing.strokeColor;
	}
	set strokeColor(e) {
		this._drawing.strokeColor = e;
	}
	get strokeDashArray() {
		return this._drawing.strokeDashArray;
	}
	set strokeDashArray(e) {
		this._drawing.strokeDashArray = e;
	}
	get strokeDashOffset() {
		return this._drawing.strokeDashOffset;
	}
	set strokeDashOffset(e) {
		this._drawing.strokeDashOffset = e;
	}
	get strokeWidth() {
		return this._drawing.strokeWidth;
	}
	set strokeWidth(e) {
		this.setDefineAndArtifact("stroke", e?.toString()), this._drawing.strokeWidth = e;
	}
	get textAntiAlias() {
		return this._drawing.textAntiAlias;
	}
	set textAntiAlias(e) {
		this._drawing.textAntiAlias = e;
	}
	textInterlineSpacing;
	get textKerning() {
		return this._drawing.textKerning;
	}
	set textKerning(e) {
		this.setDefineAndArtifact("kerning", e?.toString()), this._drawing.textKerning = e;
	}
	get textGravity() {
		return this._drawing.textGravity;
	}
	set textGravity(e) {
		this.setDefineAndArtifact("gravity", M(e)), this._drawing.textGravity = e;
	}
	get textUnderColor() {
		return this._drawing.textUnderColor;
	}
	set textUnderColor(e) {
		this._drawing.textUnderColor = e;
	}
	getDefine(e, t) {
		return t === void 0 ? this._options[e] ?? null : this._options[`${e}:${t}`] ?? null;
	}
	removeDefine(e, t) {
		if (t === void 0) delete this._options[e];
		else {
			let n = this.parseDefine(e, t);
			delete this._options[n];
		}
	}
	setDefine(e, t, n) {
		if (n === void 0) this._options[e] = t;
		else {
			let r = this.parseDefine(e, t);
			typeof n == "string" ? this._options[r] = n : typeof n == "number" ? this._options[r] = n.toString() : this._options[r] = n ? "true" : "false";
		}
	}
	setDefines(e) {
		e.getDefines().forEach((e) => {
			e !== void 0 && this.setDefine(e.format, e.name, e.value);
		});
	}
	_clone() {
		let t = new e();
		return Object.assign(t, this), t;
	}
	_use(e) {
		let t = new F(this);
		return k._disposeAfterExecution(t, e);
	}
	parseDefine(e, t) {
		return e === Ee.Unknown ? t : `${e}:${t}`;
	}
	setDefineAndArtifact(e, t) {
		t === void 0 ? this.removeDefine(e) : this.setDefine(e, t), this._onArtifact !== void 0 && this._onArtifact(e, t);
	}
}, I = class extends Ae {
	constructor(e) {
		super(), Object.assign(this, e);
	}
	extractArea;
	frameIndex;
	frameCount;
	height;
	get syncImageWithExifProfile() {
		let e = this.getDefine("exif:sync-image");
		return e === null ? !0 : e.toLowerCase() === "true";
	}
	set syncImageWithExifProfile(e) {
		this.setDefine("exif:sync-image", e.toString());
	}
	get syncImageWithTiffProperties() {
		let e = this.getDefine("tiff:sync-image");
		return e === null ? !0 : e.toLowerCase() === "true";
	}
	set syncImageWithTiffProperties(e) {
		this.setDefine("tiff:sync-image", e.toString());
	}
	width;
	_use(e) {
		let t = new F(this), n = this.getSize();
		if (n !== "" && E(n, (e) => {
			V._api._MagickSettings_SetSize(t._instance, e);
		}), this.frameIndex !== void 0 || this.frameCount !== void 0) {
			let e = this.frameIndex ?? 0, n = this.frameCount ?? 1;
			V._api._MagickSettings_SetScene(t._instance, e), V._api._MagickSettings_SetNumberScenes(t._instance, n), E((this.frameCount === void 0 ? e.toString() : `${e}-${e + n}`).toString(), (e) => {
				V._api._MagickSettings_SetScenes(t._instance, e);
			});
		}
		return this.extractArea !== void 0 && E(this.extractArea.toString(), (e) => {
			V._api._MagickSettings_Extract_Set(t._instance, e);
		}), k._disposeAfterExecution(t, e);
	}
	getSize() {
		return this.width !== void 0 && this.height !== void 0 ? `${this.width}x${this.height}` : this.width === void 0 ? this.height === void 0 ? "" : `x${this.height}` : `${this.width}x`;
	}
}, je = {
	Undefined: 0,
	No: 1,
	Riemersma: 2,
	FloydSteinberg: 3
}, Me = class extends ve {
	constructor(e) {
		let t = V._api._QuantizeSettings_Create(), n = V._api._QuantizeSettings_Dispose;
		super(t, n), V._api._QuantizeSettings_SetColors(this._instance, e.colors), V._api._QuantizeSettings_SetColorSpace(this._instance, e.colorSpace), V._api._QuantizeSettings_SetDitherMethod(this._instance, e.ditherMethod ?? je.No), V._api._QuantizeSettings_SetMeasureErrors(this._instance, +!!e.measureErrors), V._api._QuantizeSettings_SetTreeDepth(this._instance, e.treeDepth);
	}
}, Ne = class {
	constructor() {
		this.colors = 256, this.colorSpace = g.Undefined, this.ditherMethod = je.Riemersma, this.measureErrors = !1, this.treeDepth = 0;
	}
	colors;
	colorSpace;
	ditherMethod;
	measureErrors;
	treeDepth;
	_use(e) {
		let t = new Me(this);
		return k._disposeAfterExecution(t, e);
	}
}, Pe = class e {
	_image;
	_names = [];
	constructor(e) {
		this._image = e;
	}
	setArtifact(e, t) {
		this._names.push(e), this._image.setArtifact(e, t);
	}
	static use(t, n) {
		let r = new e(t);
		try {
			return n(r);
		} finally {
			r.dispose();
		}
	}
	dispose() {
		for (let e of this._names) this._image.removeArtifact(e);
	}
}, Fe = class e extends Array {
	constructor() {
		super();
	}
	static create(t) {
		let n = e.createObject();
		return t !== void 0 && n.read(t), n;
	}
	dispose() {
		let e = this.pop();
		for (; e !== void 0;) e.dispose(), e = this.pop();
	}
	appendHorizontally(e) {
		return this.createImage((e, t) => V._api._MagickImageCollection_Append(e, 0, t.ptr), e);
	}
	appendVertically(e) {
		return this.createImage((e, t) => V._api._MagickImageCollection_Append(e, 1, t.ptr), e);
	}
	clone(t) {
		return e.use((e) => {
			for (let t = 0; t < this.length; t++) e.push(B._clone(this[t]));
			return t(e);
		});
	}
	coalesce() {
		this.replaceImages((e, t) => V._api._MagickImageCollection_Coalesce(e, t.ptr));
	}
	combine(e, t) {
		let n = t, r = g.sRGB;
		return typeof e == "number" ? r = e : n = e, this.createImage((e, t) => V._api._MagickImageCollection_Combine(e, r, t.ptr), n);
	}
	complex(e, t) {
		return Pe.use(this[0], (n) => (e._setArtifacts(n), this.createImage((t, n) => V._api._MagickImageCollection_Complex(t, e.complexOperator, n.ptr), t)));
	}
	deconstruct() {
		this.replaceImages((e, t) => V._api._MagickImageCollection_Deconstruct(e, t.ptr));
	}
	evaluate(e, t) {
		return this.createImage((t, n) => V._api._MagickImageCollection_Evaluate(t, e, n.ptr), t);
	}
	flatten(e) {
		return this.mergeImages(De.Flatten, e);
	}
	fx(e, t, n) {
		this.throwIfEmpty();
		let r = h.All, i = n;
		return typeof t == "number" ? r = t : i = t, E(e, (e) => this.createImage((t, n) => V._api._MagickImageCollection_Fx(t, e, r, n.ptr), i));
	}
	merge(e) {
		return this.mergeImages(De.Merge, e);
	}
	montage(t, n) {
		return this.throwIfEmpty(), this.attachImages((r) => {
			let i = t._use((e) => A.use((t) => {
				let n = V._api._MagickImageCollection_Montage(r, e._instance, t.ptr);
				return this.checkResult(n, t);
			}));
			return e._createFromImages(i, this.getSettings(), (e) => {
				let r = t.transparentColor;
				return r !== void 0 && e.forEach((e) => {
					e.transparent(r);
				}), e.merge(n);
			});
		});
	}
	morph(e) {
		if (this.length < 2) throw new C("operation requires at least two images");
		this.replaceImages((t, n) => V._api._MagickImageCollection_Morph(t, e, n.ptr));
	}
	mosaic(e) {
		return this.mergeImages(De.Mosaic, e);
	}
	optimize() {
		this.replaceImages((e, t) => V._api._MagickImageCollection_Optimize(e, t.ptr));
	}
	optimizePlus() {
		this.replaceImages((e, t) => V._api._MagickImageCollection_OptimizePlus(e, t.ptr));
	}
	optimizeTransparency() {
		this.throwIfEmpty(), this.attachImages((e) => {
			A.usePointer((t) => {
				V._api._MagickImageCollection_OptimizeTransparency(e, t);
			});
		});
	}
	ping(e, t) {
		this.readOrPing(!0, e, t);
	}
	polynomial(e, t) {
		return this.createImage((t, n) => xe(e, (r) => V._api._MagickImageCollection_Polynomial(t, r, e.length, n.ptr)), t);
	}
	quantize(e) {
		this.throwIfEmpty();
		let t = e === void 0 ? new Ne() : e;
		return this.attachImages((e) => {
			t._use((t) => {
				A.usePointer((n) => {
					V._api._MagickImageCollection_Quantize(e, t._instance, n);
				});
			});
		}), t.measureErrors ? N._create(this[0]) : null;
	}
	read(e, t) {
		this.readOrPing(!1, e, t);
	}
	remap(e, t) {
		this.throwIfEmpty();
		let n = t === void 0 ? new Ne() : t;
		this.attachImages((t) => {
			n._use((n) => {
				A.use((r) => {
					V._api._MagickImageCollection_Remap(t, n._instance, e._instance, r.ptr);
				});
			});
		});
	}
	resetPage() {
		this.forEach((e) => {
			e.resetPage();
		});
	}
	smushHorizontal(e, t) {
		return this.smush(e, !1, t);
	}
	smushVertical(e, t) {
		return this.smush(e, !0, t);
	}
	trimBounds() {
		this.mergeImages(De.Trimbounds, () => {});
	}
	static use(t) {
		let n = e.create();
		return k._disposeAfterExecution(n, t);
	}
	write(e, t) {
		this.throwIfEmpty();
		let n = 0, r = 0, i = this[0], a = this.getSettings();
		t === void 0 ? (t = e, a.format = i.format) : a.format = e, A.use((e) => {
			_e.use((t) => {
				a._use((i) => {
					this.attachImages((a) => {
						n = V._api._MagickImage_WriteBlob(a, i._instance, t.ptr, e.ptr), r = t.value;
					});
				});
			});
		});
		let o = new he(n, r, t);
		return k._disposeAfterExecution(o, o.func);
	}
	static _createFromImages(t, n, r) {
		let i = e.createObject();
		return i.addImages(t, n._clone()), r(i);
	}
	addImages(e, t) {
		t.format = Ee.Unknown;
		let n = e;
		for (; n !== 0;) {
			let e = V._api._MagickImage_GetNext(n);
			V._api._MagickImage_SetNext(n, 0), this.push(B._createFromImage(n, t)), n = e;
		}
	}
	attachImages(e) {
		try {
			for (let e = 0; e < this.length - 1; e++) V._api._MagickImage_SetNext(this[e]._instance, this[e + 1]._instance);
			return e(this[0]._instance);
		} finally {
			for (let e = 0; e < this.length - 1; e++) V._api._MagickImage_SetNext(this[e]._instance, 0);
		}
	}
	checkResult(e, t) {
		return t.check(() => e, () => (V._api._MagickImageCollection_Dispose(e), 0));
	}
	static createObject() {
		return Object.create(e.prototype);
	}
	createImage(e, t) {
		this.throwIfEmpty();
		let n = this.attachImages((t) => A.use((n) => {
			let r = e(t, n);
			return this.checkResult(r, n);
		}));
		return B._createFromImage(n, this.getSettings())._use(t);
	}
	getSettings() {
		return this[0]._getSettings()._clone();
	}
	mergeImages(e, t) {
		return this.createImage((t, n) => V._api._MagickImageCollection_Merge(t, e, n.ptr), t);
	}
	readOrPing(e, t, n) {
		this.dispose(), A.use((r) => {
			let i = n === void 0 ? new I() : new I(n);
			i._ping = e, typeof t == "string" ? (i._fileName = t, i._use((e) => {
				let t = V._api._MagickImageCollection_ReadFile(e._instance, r.ptr);
				this.addImages(t, i);
			})) : i._use((e) => {
				let n = t.byteLength, a = 0;
				try {
					a = V._api._malloc(n), V._api.HEAPU8.set(t, a);
					let o = V._api._MagickImageCollection_ReadBlob(e._instance, a, 0, n, r.ptr);
					this.addImages(o, i);
				} finally {
					a !== 0 && V._api._free(a);
				}
			});
		});
	}
	replaceImages(e) {
		this.throwIfEmpty();
		let t = this.attachImages((t) => A.use((n) => {
			let r = e(t, n);
			return this.checkResult(r, n);
		})), n = this.getSettings()._clone();
		this.dispose(), this.addImages(t, n);
	}
	smush(e, t, n) {
		return this.createImage((n, r) => V._api._MagickImageCollection_Smush(n, e, +!!t, r.ptr), n);
	}
	throwIfEmpty() {
		if (this.length === 0) throw new C("operation requires at least one image");
	}
}, L = class e {
	_value;
	constructor(e) {
		this._value = e;
	}
	static _fromQuantum(t) {
		return new e(t / w.max * 100);
	}
	multiply(e) {
		return e * this._value / 100;
	}
	toDouble() {
		return this._value;
	}
	toString() {
		return `${parseFloat(this._value.toFixed(2))}%`;
	}
	_toQuantum() {
		return w.max * (this._value / 100);
	}
}, Ie = class {
	static use(e, t, n) {
		let r = V._api._MagickRectangle_Create();
		try {
			V._api._MagickRectangle_X_Set(r, t.x), V._api._MagickRectangle_Y_Set(r, t.y);
			let i = t.width, a = t.height;
			return t.isPercentage && (i = new L(t.width).multiply(e.width), a = new L(t.height).multiply(e.height)), V._api._MagickRectangle_Width_Set(r, i), V._api._MagickRectangle_Height_Set(r, a), n(r);
		} finally {
			V._api._MagickRectangle_Dispose(r);
		}
	}
}, Le = class {
	static _use(e, t, n) {
		let r = 0;
		try {
			return r = V._api._OffsetInfo_Create(), V._api._PrimaryInfo_X_Set(r, e), V._api._PrimaryInfo_Y_Set(r, t), n(r);
		} finally {
			V._api._free(r);
		}
	}
}, Re = class {
	_values;
	constructor() {
		this._values = Array(7).fill(0);
	}
	get(e) {
		return this._values[e];
	}
	set(e, t) {
		this._values[e] = t;
	}
}, ze = class e {
	_huPhashes = /* @__PURE__ */ new Map();
	_hash = "";
	channel;
	constructor(e, t, n) {
		if (this.channel = e, typeof n == "number") for (let e = 0; e < t.length; e++) {
			let r = new Re();
			for (let t = 0; t < 7; t++) {
				let i = V._api._ChannelPerceptualHash_GetHuPhash(n, e, t);
				r.set(t, i);
			}
			this._huPhashes.set(t[e], r);
		}
		else this.parseHash(t, n);
	}
	huPhash(e, t) {
		if (t < 0 || t > 6) throw new C("Invalid index specified");
		let n = this._huPhashes.get(e);
		if (n === void 0) throw new C("Invalid color space specified");
		return n.get(t);
	}
	sumSquaredDistance(e) {
		let t = 0;
		return this._huPhashes.forEach((n, r) => {
			for (let i = 0; i < 7; i++) {
				let a = n.get(i), o = e.huPhash(r, i);
				t += (a - o) * (a - o);
			}
		}), t;
	}
	toString() {
		return this._hash == "" && this.setHash(), this._hash;
	}
	parseHash(t, n) {
		this._hash = n;
		let r = 0;
		for (let i of t) {
			let t = new Re();
			for (let i = 0; i < 7; i++, r += 5) {
				let a = Number.parseInt(n.substring(r, r + 5), 16);
				if (isNaN(a)) throw new C("Invalid hash specified");
				let o = a / e.powerOfTen(a >> 17);
				a & 65536 && (o = -o), t.set(i, o);
			}
			this._huPhashes.set(i, t);
		}
	}
	static powerOfTen(e) {
		switch (e) {
			case 2: return 100;
			case 3: return 1e3;
			case 4: return 1e4;
			case 5: return 1e5;
			case 6: return 1e6;
			default: return 10;
		}
	}
	setHash() {
		this._hash = "", this._huPhashes.forEach((e) => {
			for (let t = 0; t < 7; t++) {
				let n = e.get(t), r = 0;
				for (; r < 7 && Math.abs(n * 10) < 65356;) n *= 10, r++;
				r <<= 1, r < 0 && (r |= 1), r = (r << 16) + Math.floor(n < 0 ? -(n - .5) : n + .5), this._hash += r.toString(16);
			}
		});
	}
}, Be = class e {
	_red;
	_green;
	_blue;
	constructor(t, n, r) {
		if (typeof t == "string") {
			let r = n ?? e._defaultColorspaces();
			e._validateColorSpaces(r);
			let i = 35 * r.length;
			if (t.length !== 3 * i) throw new C("Invalid hash size");
			this._red = new ze(m.Red, r, t.substring(0, i)), this._blue = new ze(m.Blue, r, t.substring(i, i + i)), this._green = new ze(m.Green, r, t.substring(i + i));
		} else this._red = t, this._green = n, this._blue = r;
	}
	static _create(t, n, r) {
		if (r === 0) throw new C("The native operation failed to create an instance");
		return new e(e.createChannel(t, n, r, m.Red), e.createChannel(t, n, r, m.Green), e.createChannel(t, n, r, m.Blue));
	}
	static _defaultColorspaces() {
		return [g.XyY, g.HSB];
	}
	static _validateColorSpaces(e) {
		if (e.length < 1 || e.length > 6) throw new C("Invalid number of colorspaces, the minimum is 1 and the maximum is 6");
		if (new Set(e).size !== e.length) throw new C("Specifying the same colorspace more than once is not allowed");
	}
	getChannel(e) {
		switch (e) {
			case m.Red: return this._red;
			case m.Green: return this._green;
			case m.Blue: return this._blue;
			default: return null;
		}
	}
	sumSquaredDistance(e) {
		let t = e.getChannel(m.Red), n = e.getChannel(m.Green), r = e.getChannel(m.Blue);
		if (t === null || n === null || r === null) throw new C("The other perceptual hash should contain a red, green and blue channel.");
		return this._red.sumSquaredDistance(t) + this._green.sumSquaredDistance(n) + this._blue.sumSquaredDistance(r);
	}
	toString() {
		return this._red.toString() + this._green.toString() + this._blue.toString();
	}
	static createChannel(e, t, n, r) {
		return new ze(r, t, V._api._PerceptualHash_GetInstance(e._instance, n, r));
	}
}, R = class e extends ve {
	image;
	constructor(e) {
		let t = A.usePointer((t) => V._api._PixelCollection_Create(e._instance, t)), n = V._api._PixelCollection_Dispose;
		super(t, n), this.image = e;
	}
	static _create(t) {
		return new e(t);
	}
	static _use(t, n) {
		let r = new e(t);
		return k._disposeAfterExecution(r, n);
	}
	static _map(t, n, r) {
		let i = new e(t);
		try {
			i.use(0, 0, t.width, t.height, n, (e) => {
				r(e);
			});
		} finally {
			i.dispose();
		}
	}
	getArea(e, t, n, r) {
		return A.usePointer((i) => {
			let a = V._api._PixelCollection_GetArea(this._instance, e, t, n, r, i), o = n * r * this.image.channelCount;
			return V._api.HEAPU8.subarray(a, a + o);
		});
	}
	getReadOnlyArea(e, t, n, r) {
		return A.usePointer((i) => {
			let a = V._api._PixelCollection_GetReadOnlyArea(this.image._instance, e, t, n, r, i), o = n * r * this.image.channelCount;
			return V._api.HEAPU8.subarray(a, a + o);
		});
	}
	getChannelIndex(e) {
		return this.image._channelOffset(e);
	}
	getColor(e, t) {
		let n = this.getArea(e, t, 1, 1), r = Array.from(n), i = this.image._channelOffset(m.Index);
		if (i >= 0 && r.splice(i, 1), r.length === 0) return null;
		if (r.length === 1) return new D(r[0], r[0], r[0]);
		if (r.length === 2) return new D(r[0], r[0], r[0], r[1]);
		let a = this.image._channelOffset(m.Black) >= 0, o = this.image._channelOffset(m.Alpha) >= 0;
		return a ? r.length === 4 || !o ? new D(r[0], r[1], r[2], r[3], w.max) : new D(r[0], r[1], r[2], r[3], r[4]) : r.length === 3 || !o ? new D(r[0], r[1], r[2]) : new D(r[0], r[1], r[2], r[3]);
	}
	getPixel(e, t) {
		return this.getArea(e, t, 1, 1);
	}
	setArea(e, t, n, r, i) {
		A.usePointer((a) => {
			let o = i instanceof Uint8Array ? i : new Uint8Array(i);
			Se(o, (i) => {
				V._api._PixelCollection_SetArea(this._instance, e, t, n, r, i, o.length, a);
			});
		});
	}
	setPixel(e, t, n) {
		n instanceof Uint8Array, this.setArea(e, t, 1, 1, n);
	}
	toByteArray(e, t, n, r, i) {
		return this.use(e, t, n, r, i, (e) => {
			if (e === 0) return null;
			let t = n * r * i.length;
			return V._api.HEAPU8.slice(e, e + t);
		});
	}
	use(e, t, n, r, i, a) {
		return E(i, (i) => A.use((o) => {
			let s = V._api._PixelCollection_ToByteArray(this._instance, e, t, n, r, i, o.ptr);
			return o.check(() => {
				let e = a(s);
				return s = V._api._MagickMemory_Relinquish(s), e;
			}, () => (s = V._api._MagickMemory_Relinquish(s), null));
		}));
	}
}, Ve = {
	Undefined: 0,
	Average: 1,
	Brightness: 2,
	Lightness: 3,
	MS: 4,
	Rec601Luma: 5,
	Rec601Luminance: 6,
	Rec709Luma: 7,
	Rec709Luminance: 8,
	RMS: 9
}, He = {
	Undefined: 0,
	Average: 1,
	Average9: 2,
	Average16: 3,
	Background: 4,
	Bilinear: 5,
	Blend: 6,
	Catrom: 7,
	Integer: 8,
	Mesh: 9,
	Nearest: 10,
	Spline: 11
}, z = class e {
	constructor(e, t, n) {
		this.x = e, this.y = t, this.z = n;
	}
	x;
	y;
	z;
	static _create(t) {
		return t === 0 ? new e(0, 0, 0) : new e(V._api._PrimaryInfo_X_Get(t), V._api._PrimaryInfo_Y_Get(t), V._api._PrimaryInfo_Z_Get(t));
	}
	_use(e) {
		let t = 0;
		try {
			t = V._api._PrimaryInfo_Create(), V._api._PrimaryInfo_X_Set(t, this.x), V._api._PrimaryInfo_Y_Set(t, this.y), V._api._PrimaryInfo_Z_Set(t, this.z), e(t);
		} finally {
			V._api._PrimaryInfo_Dispose(t);
		}
	}
}, Ue = class {
	channel;
	depth;
	entropy;
	kurtosis;
	maximum;
	mean;
	minimum;
	skewness;
	standardDeviation;
	constructor(e, t) {
		this.channel = e, this.depth = V._api._ChannelStatistics_Depth_Get(t), this.entropy = V._api._ChannelStatistics_Entropy_Get(t), this.kurtosis = V._api._ChannelStatistics_Kurtosis_Get(t), this.maximum = V._api._ChannelStatistics_Maximum_Get(t), this.mean = V._api._ChannelStatistics_Mean_Get(t), this.minimum = V._api._ChannelStatistics_Minimum_Get(t), this.skewness = V._api._ChannelStatistics_Skewness_Get(t), this.standardDeviation = V._api._ChannelStatistics_StandardDeviation_Get(t);
	}
}, We = class e {
	_channels = /* @__PURE__ */ new Map();
	get channels() {
		return Array.from(this._channels.keys());
	}
	composite() {
		return this._channels.get(m.Composite);
	}
	getChannel(e) {
		let t = this._channels.get(e);
		return t === void 0 ? null : t;
	}
	static _create(t, n, r) {
		let i = new e();
		return t.channels.forEach((e) => {
			r >> e & 1 && i.addChannel(n, e);
		}), i.addChannel(n, m.Composite), i;
	}
	addChannel(e, t) {
		let n = V._api._Statistics_GetInstance(e, t);
		n !== 0 && this._channels.set(t, new Ue(t, n));
	}
}, Ge = class {
	static toArray(e) {
		if (e === 0) return null;
		let t = V._api._StringInfo_Datum_Get(e), n = V._api._StringInfo_Length_Get(e);
		return V._api.HEAPU8.subarray(t, t + n);
	}
}, Ke = class {
	constructor(e) {
		this.error = e;
	}
	error;
}, B = class t extends ve {
	_settings;
	_progress;
	_warning;
	constructor(e, t) {
		super(e, V._api._MagickImage_Dispose), this._settings = t, this._settings._onArtifact = this.onSettingsArtifactChanged.bind(this);
	}
	get animationDelay() {
		return V._api._MagickImage_AnimationDelay_Get(this._instance);
	}
	set animationDelay(e) {
		V._api._MagickImage_AnimationDelay_Set(this._instance, e);
	}
	get animationIterations() {
		return V._api._MagickImage_AnimationIterations_Get(this._instance);
	}
	set animationIterations(e) {
		V._api._MagickImage_AnimationIterations_Set(this._instance, e);
	}
	get animationTicksPerSecond() {
		return V._api._MagickImage_AnimationTicksPerSecond_Get(this._instance);
	}
	set animationTicksPerSecond(e) {
		V._api._MagickImage_AnimationTicksPerSecond_Set(this._instance, e);
	}
	get artifactNames() {
		let e = [];
		V._api._MagickImage_ResetArtifactIterator(this._instance);
		let t = V._api._MagickImage_GetNextArtifactName(this._instance);
		for (; t !== 0;) e.push(V._api.UTF8ToString(t)), t = V._api._MagickImage_GetNextArtifactName(this._instance);
		return e;
	}
	get attributeNames() {
		let e = [];
		V._api._MagickImage_ResetAttributeIterator(this._instance);
		let t = V._api._MagickImage_GetNextAttributeName(this._instance);
		for (; t !== 0;) e.push(V._api.UTF8ToString(t)), t = V._api._MagickImage_GetNextAttributeName(this._instance);
		return e;
	}
	get backgroundColor() {
		let e = V._api._MagickImage_BackgroundColor_Get(this._instance);
		return D._create(e);
	}
	set backgroundColor(e) {
		e._use((e) => {
			V._api._MagickImage_BackgroundColor_Set(this._instance, e);
		});
	}
	get baseHeight() {
		return V._api._MagickImage_BaseHeight_Get(this._instance);
	}
	get baseWidth() {
		return V._api._MagickImage_BaseWidth_Get(this._instance);
	}
	get blackPointCompensation() {
		return V._api._MagickImage_BlackPointCompensation_Get(this._instance) === 1;
	}
	set blackPointCompensation(e) {
		V._api._MagickImage_BlackPointCompensation_Set(this._instance, +!!e);
	}
	get borderColor() {
		let e = V._api._MagickImage_BorderColor_Get(this._instance);
		return D._create(e);
	}
	set borderColor(e) {
		e._use((e) => {
			V._api._MagickImage_BorderColor_Set(this._instance, e);
		});
	}
	get boundingBox() {
		return this.useExceptionPointer((e) => {
			let t = V._api._MagickImage_BoundingBox_Get(this._instance, e), n = O._fromRectangle(t);
			return n.width === 0 || n.height === 0 ? null : n;
		});
	}
	get channelCount() {
		return V._api._MagickImage_ChannelCount_Get(this._instance);
	}
	get channels() {
		let e = [];
		return [
			m.Red,
			m.Green,
			m.Blue,
			m.Black,
			m.Alpha
		].forEach((t) => {
			V._api._MagickImage_HasChannel(this._instance, t) && e.push(t);
		}), e;
	}
	get chromaticity() {
		return new te(z._create(V._api._MagickImage_ChromaRed_Get(this._instance)), z._create(V._api._MagickImage_ChromaGreen_Get(this._instance)), z._create(V._api._MagickImage_ChromaBlue_Get(this._instance)), z._create(V._api._MagickImage_ChromaWhite_Get(this._instance)));
	}
	set chromaticity(e) {
		e.blue._use((e) => V._api._MagickImage_ChromaBlue_Set(this._instance, e)), e.green._use((e) => V._api._MagickImage_ChromaGreen_Set(this._instance, e)), e.red._use((e) => V._api._MagickImage_ChromaRed_Set(this._instance, e)), e.white._use((e) => V._api._MagickImage_ChromaWhite_Set(this._instance, e));
	}
	get classType() {
		return V._api._MagickImage_ClassType_Get(this._instance);
	}
	set classType(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_ClassType_Set(this._instance, e, t);
		});
	}
	get colorFuzz() {
		return L._fromQuantum(V._api._MagickImage_ColorFuzz_Get(this._instance));
	}
	set colorFuzz(e) {
		let t = e._toQuantum();
		V._api._MagickImage_ColorFuzz_Set(this._instance, t), this._settings._colorFuzz = t;
	}
	get colormapSize() {
		return V._api._MagickImage_ColormapSize_Get(this._instance);
	}
	set colormapSize(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_ColormapSize_Set(this._instance, e, t);
		});
	}
	get colorSpace() {
		return V._api._MagickImage_ColorSpace_Get(this._instance);
	}
	set colorSpace(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_ColorSpace_Set(this._instance, e, t);
		});
	}
	get colorType() {
		return this.settings.colorType === void 0 ? V._api._MagickImage_ColorType_Get(this._instance) : this.settings.colorType;
	}
	set colorType(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_ColorType_Set(this._instance, e, t);
		});
	}
	get comment() {
		return this.getAttribute("comment");
	}
	set comment(e) {
		e === null ? this.removeAttribute("comment") : this.setAttribute("comment", e);
	}
	get compose() {
		return V._api._MagickImage_Compose_Get(this._instance);
	}
	set compose(e) {
		V._api._MagickImage_Compose_Set(this._instance, e);
	}
	get compression() {
		return V._api._MagickImage_Compression_Get(this._instance);
	}
	get density() {
		return new me(V._api._MagickImage_ResolutionX_Get(this._instance), V._api._MagickImage_ResolutionY_Get(this._instance), V._api._MagickImage_ResolutionUnits_Get(this._instance));
	}
	set density(e) {
		V._api._MagickImage_ResolutionX_Set(this._instance, e.x), V._api._MagickImage_ResolutionY_Set(this._instance, e.y), V._api._MagickImage_ResolutionUnits_Set(this._instance, e.units);
	}
	get depth() {
		return V._api._MagickImage_Depth_Get(this._instance);
	}
	set depth(e) {
		V._api._MagickImage_Depth_Set(this._instance, e);
	}
	get endian() {
		return V._api._MagickImage_Endian_Get(this._instance);
	}
	set endian(e) {
		V._api._MagickImage_Endian_Set(this._instance, e);
	}
	get fileName() {
		let e = V._api._MagickImage_FileName_Get(this._instance);
		return e === 0 ? null : V._api.UTF8ToString(e);
	}
	get filterType() {
		return V._api._MagickImage_FilterType_Get(this._instance);
	}
	set filterType(e) {
		V._api._MagickImage_FilterType_Set(this._instance, e);
	}
	get format() {
		return T(V._api._MagickImage_Format_Get(this._instance), "");
	}
	set format(e) {
		E(e.toString(), (e) => V._api._MagickImage_Format_Set(this._instance, e));
	}
	get gamma() {
		return V._api._MagickImage_Gamma_Get(this._instance);
	}
	get gifDisposeMethod() {
		return V._api._MagickImage_GifDisposeMethod_Get(this._instance);
	}
	set gifDisposeMethod(e) {
		V._api._MagickImage_GifDisposeMethod_Set(this._instance, e);
	}
	get hasAlpha() {
		return this.toBool(V._api._MagickImage_HasAlpha_Get(this._instance));
	}
	set hasAlpha(e) {
		this.useExceptionPointer((t) => {
			e && this.alpha(ee.Opaque), V._api._MagickImage_HasAlpha_Set(this._instance, this.fromBool(e), t);
		});
	}
	get height() {
		return V._api._MagickImage_Height_Get(this._instance);
	}
	get interlace() {
		return V._api._MagickImage_Interlace_Get(this._instance);
	}
	get isOpaque() {
		return this.useExceptionPointer((e) => this.toBool(V._api._MagickImage_IsOpaque_Get(this._instance, e)));
	}
	get interpolate() {
		return V._api._MagickImage_Interpolate_Get(this._instance);
	}
	set interpolate(e) {
		V._api._MagickImage_Interpolate_Set(this._instance, e);
	}
	get label() {
		return this.getAttribute("label");
	}
	set label(e) {
		e === null ? this.removeAttribute("label") : this.setAttribute("label", e);
	}
	get matteColor() {
		let e = V._api._MagickImage_MatteColor_Get(this._instance);
		return D._create(e);
	}
	set matteColor(e) {
		e._use((e) => {
			V._api._MagickImage_MatteColor_Set(this._instance, e);
		});
	}
	get metaChannelCount() {
		return V._api._MagickImage_MetaChannelCount_Get(this._instance);
	}
	set metaChannelCount(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_MetaChannelCount_Set(this._instance, e, t);
		});
	}
	get orientation() {
		return V._api._MagickImage_Orientation_Get(this._instance);
	}
	set orientation(e) {
		V._api._MagickImage_Orientation_Set(this._instance, e);
	}
	get onProgress() {
		return this._progress;
	}
	set onProgress(e) {
		e === void 0 ? this.disposeProgressDelegate() : H.setProgressDelegate(this), this._progress = e;
	}
	get onWarning() {
		return this._warning;
	}
	set onWarning(e) {
		this._warning = e;
	}
	get page() {
		let e = V._api._MagickImage_Page_Get(this._instance);
		return O._fromRectangle(e);
	}
	set page(e) {
		e._toRectangle((e) => {
			V._api._MagickImage_Page_Set(this._instance, e);
		});
	}
	get profileNames() {
		let e = [];
		V._api._MagickImage_ResetProfileIterator(this._instance);
		let t = V._api._MagickImage_GetNextProfileName(this._instance);
		for (; t !== 0;) e.push(V._api.UTF8ToString(t)), t = V._api._MagickImage_GetNextProfileName(this._instance);
		return e;
	}
	get quality() {
		return V._api._MagickImage_Quality_Get(this._instance);
	}
	set quality(e) {
		let t = e < 1 ? 1 : e;
		t = t > 100 ? 100 : t, V._api._MagickImage_Quality_Set(this._instance, t), this._settings._quality = t;
	}
	get renderingIntent() {
		return V._api._MagickImage_RenderingIntent_Get(this._instance);
	}
	set renderingIntent(e) {
		V._api._MagickImage_RenderingIntent_Set(this._instance, e);
	}
	get settings() {
		return this._settings;
	}
	get signature() {
		return this.useExceptionPointer((e) => T(V._api._MagickImage_Signature_Get(this._instance, e)));
	}
	get totalColors() {
		return this.useExceptionPointer((e) => V._api._MagickImage_TotalColors_Get(this._instance, e));
	}
	get virtualPixelMethod() {
		return V._api._MagickImage_VirtualPixelMethod_Get(this._instance);
	}
	set virtualPixelMethod(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_VirtualPixelMethod_Set(this._instance, e, t);
		});
	}
	get width() {
		return V._api._MagickImage_Width_Get(this._instance);
	}
	adaptiveBlur(e, t) {
		let n = this.valueOrDefault(e, 0), r = this.valueOrDefault(t, 1);
		this.useException((e) => {
			let t = V._api._MagickImage_AdaptiveBlur(this._instance, n, r, e.ptr);
			this._setInstance(t, e);
		});
	}
	adaptiveResize(e, t) {
		let n = typeof e == "number" ? new O(0, 0, e, t) : e;
		this.useException((e) => {
			E(n.toString(), (t) => {
				let n = V._api._MagickImage_AdaptiveResize(this._instance, t, e.ptr);
				this._setInstance(n, e);
			});
		});
	}
	adaptiveSharpen(e, t, n) {
		let r = 0, i = t ?? 1, a = n ?? h.Undefined;
		e !== void 0 && (t === void 0 ? a = e : r = e), this.useException((e) => {
			let t = V._api._MagickImage_AdaptiveSharpen(this._instance, r, i, a, e.ptr);
			this._setInstance(t, e);
		});
	}
	adaptiveThreshold(e, t, n, r) {
		let i = n instanceof L ? n._toQuantum() : 0, a = r ?? h.Undefined;
		typeof n == "number" && (a = n), this.useException((n) => {
			let r = V._api._MagickImage_AdaptiveThreshold(this._instance, e, t, i, a, n.ptr);
			this._setInstance(r, n);
		});
	}
	addNoise(e, t, n) {
		let r = 1, i = n ?? h.Undefined;
		t !== void 0 && (n === void 0 ? i = t : r = t), this.useException((t) => {
			let n = V._api._MagickImage_AddNoise(this._instance, e, r, i, t.ptr);
			this._setInstance(n, t);
		});
	}
	affineTransform(e) {
		this.useException((t) => {
			let n = V._api._MagickImage_AffineTransform(this._instance, e.scaleX, e.scaleY, e.shearX, e.shearY, e.translateX, e.translateY, t.ptr);
			this._setInstance(n, t);
		});
	}
	alpha(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_SetAlpha(this._instance, e, t);
		});
	}
	annotate(e, t, n, r) {
		return this.useExceptionPointer((i) => this._settings._drawing._use((a) => {
			E(e, (e) => {
				let o = null, s = j.Undefined, c = 0;
				typeof t == "object" ? (o = t.toString(), n !== void 0 && (s = n), r !== void 0 && (c = r)) : (s = t, n !== void 0 && (c = n)), E(o, (t) => {
					V._api._MagickImage_Annotate(this._instance, a._instance, e, t, s, c, i);
				});
			});
		}));
	}
	autoGamma(e) {
		this.useExceptionPointer((t) => {
			let n = this.valueOrDefault(e, h.Composite);
			V._api._MagickImage_AutoGamma(this._instance, n, t);
		});
	}
	autoLevel(e) {
		this.useExceptionPointer((t) => {
			let n = this.valueOrDefault(e, h.Undefined);
			V._api._MagickImage_AutoLevel(this._instance, n, t);
		});
	}
	autoOrient() {
		this.useException((e) => {
			let t = V._api._MagickImage_AutoOrient(this._instance, e.ptr);
			this._setInstance(t, e);
		});
	}
	autoThreshold(e) {
		this.useException((t) => {
			V._api._MagickImage_AutoThreshold(this._instance, e, t.ptr);
		});
	}
	bilateralBlur(e, t, n, r) {
		let i = this.valueOrComputedDefault(n, () => Math.sqrt(e * e + t * t)), a = this.valueOrDefault(r, i * .25);
		this.useException((n) => {
			let r = V._api._MagickImage_BilateralBlur(this._instance, e, t, i, a, n.ptr);
			this._setInstance(r, n);
		});
	}
	blackThreshold(e, t) {
		let n = this.valueOrDefault(t, h.Composite);
		this.useException((t) => {
			E(e.toString(), (e) => {
				V._api._MagickImage_BlackThreshold(this._instance, e, n, t.ptr);
			});
		});
	}
	blueShift(e) {
		let t = this.valueOrDefault(e, 1.5);
		this.useException((e) => {
			let n = V._api._MagickImage_BlueShift(this._instance, t, e.ptr);
			this._setInstance(n, e);
		});
	}
	blur(e, t, n) {
		let r = 0, i = this.valueOrDefault(t, 1), a = this.valueOrDefault(n, h.Undefined);
		e !== void 0 && (t === void 0 ? a = e : r = e), this.useException((e) => {
			let t = V._api._MagickImage_Blur(this._instance, r, i, a, e.ptr);
			this._setInstance(t, e);
		});
	}
	border(e, t) {
		let n = new O(0, 0, e, this.valueOrDefault(t, e));
		this.useException((e) => {
			n._toRectangle((t) => {
				let n = V._api._MagickImage_Border(this._instance, t, e.ptr);
				this._setInstance(n, e);
			});
		});
	}
	brightnessContrast(e, t, n) {
		let r = this.valueOrDefault(n, h.Undefined);
		this.useException((n) => {
			V._api._MagickImage_BrightnessContrast(this._instance, e.toDouble(), t.toDouble(), r, n.ptr);
		});
	}
	cannyEdge(e, t, n, r) {
		let i = this.valueOrDefault(e, 0), a = this.valueOrDefault(t, 1), o = this.valueOrDefault(n, new L(10)).toDouble() / 100, s = this.valueOrDefault(r, new L(30)).toDouble() / 100;
		this.useException((e) => {
			let t = V._api._MagickImage_CannyEdge(this._instance, i, a, o, s, e.ptr);
			this._setInstance(t, e);
		});
	}
	charcoal(e, t) {
		let n = e === void 0 ? 0 : e, r = t === void 0 ? 1 : t;
		this.useException((e) => {
			let t = V._api._MagickImage_Charcoal(this._instance, n, r, e.ptr);
			this._setInstance(t, e);
		});
	}
	chop(e) {
		this.useException((t) => {
			e._toRectangle((e) => {
				let n = V._api._MagickImage_Chop(this._instance, e, t.ptr);
				this._setInstance(n, t);
			});
		});
	}
	chopHorizontal(e, t) {
		this.chop(new O(e, 0, t, 0));
	}
	chopVertical(e, t) {
		this.chop(new O(0, e, 0, t));
	}
	clahe(e, t, n, r) {
		this.useExceptionPointer((i) => {
			let a = e instanceof L ? e.multiply(this.width) : e, o = t instanceof L ? t.multiply(this.height) : t;
			V._api._MagickImage_Clahe(this._instance, a, o, n, r, i);
		});
	}
	clone(e) {
		return t._clone(this)._use(e);
	}
	cloneArea(e, n) {
		return A.usePointer((r) => e._toRectangle((i) => Le._use(0, 0, (a) => {
			let o = V._api._MagickImage_CloneArea(this._instance, e.width, e.height, r);
			return V._api._MagickImage_CopyPixels(o, this._instance, i, a, h.Undefined, r), n(new t(o, this._settings));
		})));
	}
	clut(e, t, n) {
		let r = this.valueOrDefault(t, He.Undefined), i = this.valueOrDefault(n, h.Undefined);
		this.useExceptionPointer((t) => {
			V._api._MagickImage_Clut(this._instance, e._instance, r, i, t);
		});
	}
	colorAlpha(e) {
		if (!this.hasAlpha) return;
		let n = t.create();
		n.read(e, this.width, this.height), n.composite(this, ae.SrcOver, new ue(0, 0)), this._instance = n._instance;
	}
	colorDecisionList(e) {
		this.useExceptionPointer((t) => {
			E(e, (e) => {
				V._api._MagickImage_ColorDecisionList(this._instance, e, t);
			});
		});
	}
	compare(e, n, r, i) {
		let a = n instanceof S, o = a ? n.metric : n, s = r;
		i !== void 0 && (s = i);
		let c = h.Undefined;
		if (typeof s != "function") return s !== void 0 && (c = s), this.useExceptionPointer((t) => V._api._MagickImage_CompareDistortion(this._instance, e._instance, o, c, t));
		r !== void 0 && typeof r != "function" && (c = r);
		let l = Pe.use(this, (r) => (a && n._setArtifacts(r), we.use((n) => {
			let r = this.useExceptionPointer((t) => V._api._MagickImage_Compare(this._instance, e._instance, o, c, n.ptr, t)), i = n.value, a = t._createFromImage(r, this._settings);
			return ie._create(i, a);
		})));
		return l.difference._use(() => s(l));
	}
	composite(e, t, n, r, i) {
		let a = 0, o = 0, s = ae.In, c = h.All, l = null;
		t instanceof ue ? (a = t.x, o = t.y) : t !== void 0 && (s = t), n instanceof ue ? (a = n.x, o = n.y) : typeof n == "string" ? l = n : n !== void 0 && (c = n), typeof r == "string" ? l = r : r !== void 0 && (c = r), i !== void 0 && (c = i), l !== null && this.setArtifact("compose:args", l), this.useExceptionPointer((t) => {
			V._api._MagickImage_Composite(this._instance, e._instance, a, o, s, c, t);
		}), l !== null && this.removeArtifact("compose:args");
	}
	compositeGravity(e, t, n, r, i, a) {
		let o = 0, s = 0, c = ae.In, l = h.All, u = null;
		n instanceof ue ? (o = n.x, s = n.y) : n !== void 0 && (c = n), r instanceof ue ? (o = r.x, s = r.y) : typeof r == "string" ? u = r : r !== void 0 && (l = r), typeof i == "string" ? u = i : i !== void 0 && (l = i), a !== void 0 && (l = a), u !== null && this.setArtifact("compose:args", u), this.useExceptionPointer((n) => {
			V._api._MagickImage_CompositeGravity(this._instance, e._instance, t, o, s, c, l, n);
		}), u !== null && this.removeArtifact("compose:args");
	}
	connectedComponents(e) {
		let t = typeof e == "number" ? new fe(e) : e;
		return Pe.use(this, (e) => (t._setArtifacts(e), this.useException((e) => _e.use((n) => {
			try {
				let r = V._api._MagickImage_ConnectedComponents(this._instance, t.connectivity, n.ptr, e.ptr);
				return this._setInstance(r, e), de._create(n.value, this.colormapSize);
			} finally {
				n.value !== 0 && V._api._ConnectedComponent_DisposeList(n.value);
			}
		}))));
	}
	contrast = () => this.contrastPrivate(!0);
	contrastStretch(e, t, n) {
		let r = this.width * this.height, i = e.multiply(r), a = 0, o = this.valueOrDefault(n, h.Undefined);
		t instanceof L ? a = r - t.multiply(r) : (a = r - e.multiply(r), t !== void 0 && (o = t)), this.useExceptionPointer((e) => {
			V._api._MagickImage_ContrastStretch(this._instance, i, a, o, e);
		});
	}
	static create(e, n, r) {
		let i = new t(t.createInstance(), new Ae());
		return e !== void 0 && i.readOrPing(!1, e, n, r), i;
	}
	crop(e, t, n) {
		let r, i;
		typeof e == "number" ? t !== void 0 && (r = new O(e, t), i = this.valueOrDefault(n, j.Undefined)) : (r = e, i = this.valueOrDefault(t, j.Undefined)), this.useException((e) => {
			E(r.toString(), (t) => {
				let n = V._api._MagickImage_Crop(this._instance, t, i, e.ptr);
				this._setInstance(n, e);
			});
		});
	}
	cropToTiles(e, t, n) {
		let r, i;
		return typeof e == "number" && typeof t == "number" && n !== void 0 ? (r = new O(0, 0, e, t), i = n) : typeof e != "number" && typeof t != "number" && (r = e, i = t), this.useException((e) => E(r.toString(), (t) => {
			let n = V._api._MagickImage_CropToTiles(this._instance, t, e.ptr);
			return Fe._createFromImages(n, this._settings, (e) => i(e));
		}));
	}
	cycleColormap(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_CycleColormap(this._instance, e, t);
		});
	}
	deskew(e, t) {
		return Pe.use(this, (n) => {
			t !== void 0 && n.setArtifact("deskew:auto-crop", t), this.useException((t) => {
				let n = V._api._MagickImage_Deskew(this._instance, e._toQuantum(), t.ptr);
				this._setInstance(n, t);
			});
			let r = Number(this.getArtifact("deskew:angle"));
			return isNaN(r) ? 0 : r;
		});
	}
	determineBitDepth(e) {
		let t = this.valueOrDefault(e, h.Undefined);
		return this.useExceptionPointer((e) => V._api._MagickImage_DetermineBitDepth(this._instance, t, e));
	}
	distort(e, t) {
		Pe.use(this, (n) => {
			let r, i = 0;
			typeof e == "number" ? r = e : (r = e.method, i = +!!e.bestFit, e._setArtifacts(n)), this.useException((e) => {
				xe(t, (n) => {
					let a = V._api._MagickImage_Distort(this._instance, r, i, n, t.length, e.ptr);
					this._setInstance(a, e);
				});
			});
		});
	}
	draw(...e) {
		let t = e.flat();
		t.length !== 0 && Ce._use(this, (e) => {
			e.draw(t);
		});
	}
	evaluate(e, t, n, r) {
		if (typeof t == "number") {
			let r = t, i = typeof n == "number" ? n : n._toQuantum();
			this.useExceptionPointer((t) => {
				V._api._MagickImage_EvaluateOperator(this._instance, e, r, i, t);
			});
		} else if (r !== void 0) {
			if (typeof n != "number") throw new C("this should not happen");
			let i = t, a = n, o = typeof r == "number" ? r : r._toQuantum();
			if (i.isPercentage) throw new C("percentage is not supported");
			this.useExceptionPointer((t) => {
				Ie.use(this, i, (n) => {
					V._api._MagickImage_EvaluateGeometry(this._instance, e, n, a, o, t);
				});
			});
		}
	}
	extent(e, t, n) {
		let r = j.Undefined, i;
		typeof e == "number" ? typeof t == "number" && (i = new O(e, t)) : i = e, typeof t == "number" ? r = t : t !== void 0 && (this.backgroundColor = t), typeof n == "number" ? r = n : n !== void 0 && (this.backgroundColor = n), this.useException((e) => {
			E(i.toString(), (t) => {
				let n = V._api._MagickImage_Extent(this._instance, t, r, e.ptr);
				this._setInstance(n, e);
			});
		});
	}
	flip() {
		this.useException((e) => {
			let t = V._api._MagickImage_Flip(this._instance, e.ptr);
			this._setInstance(t, e);
		});
	}
	floodFill(e, t, n, r) {
		this.floodFillPrivate(e, t, n, r, !1);
	}
	flop() {
		this.useException((e) => {
			let t = V._api._MagickImage_Flop(this._instance, e.ptr);
			this._setInstance(t, e);
		});
	}
	formatExpression(e) {
		return this.useExceptionPointer((t) => this._settings._use((n) => E(e, (e) => {
			let r = V._api._MagickImage_FormatExpression(this._instance, n._instance, e, t);
			return se(V._api, r);
		})));
	}
	gammaCorrect(e, t) {
		let n = this.valueOrDefault(t, h.Undefined);
		this.useExceptionPointer((t) => {
			V._api._MagickImage_GammaCorrect(this._instance, e, n, t);
		});
	}
	gaussianBlur(e, t, n) {
		let r = this.valueOrDefault(t, 1), i = this.valueOrDefault(n, h.Undefined);
		this.useException((t) => {
			let n = V._api._MagickImage_GaussianBlur(this._instance, e, r, i, t.ptr);
			this._setInstance(n, t);
		});
	}
	getArtifact(e) {
		return E(e, (e) => T(V._api._MagickImage_GetArtifact(this._instance, e)));
	}
	getAttribute(e) {
		return this.useException((t) => E(e, (e) => T(V._api._MagickImage_GetAttribute(this._instance, e, t.ptr))));
	}
	getColormapColor(e) {
		let t = V._api._MagickImage_GetColormapColor(this._instance, e);
		return t === 0 ? null : D._create(t);
	}
	getColorProfile() {
		for (let e of ["icc", "icm"]) {
			let t = this.getProfilePrivate(e);
			if (t !== null) return new b(t);
		}
		return null;
	}
	getPixels(e) {
		if (this._settings._ping) throw new C("image contains no pixel data");
		return R._use(this, e);
	}
	getProfile(e) {
		let t = this.getProfilePrivate(e);
		return t === null ? null : new re(e, t);
	}
	getWriteMask(e) {
		let n = this.useExceptionPointer((e) => V._api._MagickImage_GetWriteMask(this._instance, e)), r = n === 0 ? null : new t(n, new Ae());
		return r == null ? e(r) : r._use(e);
	}
	grayscale(e = Ve.Undefined) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_Grayscale(this._instance, e, t);
		});
	}
	hasProfile(e) {
		return E(e, (e) => this.toBool(V._api._MagickImage_HasProfile(this._instance, e)));
	}
	histogram() {
		let e = /* @__PURE__ */ new Map();
		return this.useExceptionPointer((t) => {
			_e.use((n) => {
				let r = V._api._MagickImage_Histogram(this._instance, n.ptr, t);
				if (r !== 0) {
					let t = n.value;
					for (let n = 0; n < t; n++) {
						let t = V._api._MagickColorCollection_GetInstance(r, n), i = D._create(t), a = V._api._MagickColor_Count_Get(t);
						e.set(i.toString(), a);
					}
					V._api._MagickColorCollection_DisposeList(r);
				}
			});
		}), e;
	}
	inverseContrast = () => this.contrastPrivate(!1);
	inverseFloodFill(e, t, n, r) {
		this.floodFillPrivate(e, t, n, r, !0);
	}
	inverseLevel(e, t, n, r) {
		let i = this.valueOrDefault(n, 1), a = this.valueOrDefault(r, h.Composite);
		this.useExceptionPointer((n) => {
			V._api._MagickImage_InverseLevel(this._instance, e.toDouble(), t._toQuantum(), i, a, n);
		});
	}
	inverseOpaque = (e, t) => this.opaquePrivate(e, t, !0);
	inverseSigmoidalContrast(e, t, n) {
		this.sigmoidalContrastPrivate(!1, e, t, n);
	}
	inverseTransparent = (e) => this.transparentPrivate(e, !0);
	level(e, t, n, r) {
		let i = this.valueOrDefault(n, 1), a = this.valueOrDefault(r, h.Composite);
		this.useExceptionPointer((n) => {
			V._api._MagickImage_Level(this._instance, e.toDouble(), t._toQuantum(), i, a, n);
		});
	}
	linearStretch(e, t) {
		this.useExceptionPointer((n) => {
			V._api._MagickImage_LinearStretch(this._instance, e.toDouble(), t._toQuantum(), n);
		});
	}
	liquidRescale(e, t) {
		let n = typeof e == "number" ? new O(e, t) : e;
		this.useException((e) => {
			E(n.toString(), (t) => {
				let r = V._api._MagickImage_LiquidRescale(this._instance, t, n.x, n.y, e.ptr);
				this._setInstance(r, e);
			});
		});
	}
	negate(e) {
		this.useExceptionPointer((t) => {
			let n = this.valueOrDefault(e, h.Undefined);
			V._api._MagickImage_Negate(this._instance, 0, n, t);
		});
	}
	negateGrayScale(e) {
		this.useExceptionPointer((t) => {
			let n = this.valueOrDefault(e, h.Undefined);
			V._api._MagickImage_Negate(this._instance, 1, n, t);
		});
	}
	normalize() {
		this.useExceptionPointer((e) => {
			V._api._MagickImage_Normalize(this._instance, e);
		});
	}
	modulate(e, t, n) {
		let r = this.valueOrDefault(t, new L(100)), i = this.valueOrDefault(n, new L(100));
		this.useExceptionPointer((t) => {
			E(`${e.toDouble()}/${r.toDouble()}/${i.toDouble()}`, (e) => {
				V._api._MagickImage_Modulate(this._instance, e, t);
			});
		});
	}
	morphology(e) {
		this.useException((t) => {
			E(e.kernel, (n) => {
				let r = V._api._MagickImage_Morphology(this._instance, e.method, n, e.channels, e.iterations, t.ptr);
				this._setInstance(r, t);
			});
		});
	}
	motionBlur(e, t, n) {
		this.useException((r) => {
			let i = V._api._MagickImage_MotionBlur(this._instance, e, t, n, r.ptr);
			this._setInstance(i, r);
		});
	}
	oilPaint(e) {
		let t = this.valueOrDefault(e, 3);
		this.useException((e) => {
			let n = V._api._MagickImage_OilPaint(this._instance, t, 0, e.ptr);
			this._setInstance(n, e);
		});
	}
	opaque = (e, t) => this.opaquePrivate(e, t, !1);
	ping(e, t) {
		this.readOrPing(!0, e, t);
	}
	perceptualHash(e) {
		let t = this.valueOrDefault(e, Be._defaultColorspaces());
		return Be._validateColorSpaces(t), Pe.use(this, (e) => {
			let n = t.map((e) => ne[e]).join(",");
			return e.setArtifact("phash:colorspaces", n), this.useExceptionPointer((e) => {
				let n = V._api._MagickImage_PerceptualHash(this._instance, e);
				try {
					return Be._create(this, t, n);
				} finally {
					V._api._PerceptualHash_DisposeList(n);
				}
			});
		});
	}
	quantize(e) {
		let t = this.valueOrDefault(e, new Ne());
		return this.useException((e) => {
			t._use((t) => {
				V._api._MagickImage_Quantize(this._instance, t._instance, e.ptr);
			});
		}), t.measureErrors ? N._create(this) : null;
	}
	read(e, t, n) {
		this.readOrPing(!1, e, t, n);
	}
	readFromCanvas(e, t) {
		let n = e.getContext("2d", t);
		if (n === null) return;
		let r = n.getImageData(0, 0, e.width, e.height), i = new I();
		i.format = Ee.Rgba, i.width = e.width, i.height = e.height, this.useException((e) => {
			this.readFromArray(r.data, i, e);
		});
	}
	removeArtifact(e) {
		E(e, (e) => {
			V._api._MagickImage_RemoveArtifact(this._instance, e);
		});
	}
	removeAttribute(e) {
		E(e, (e) => {
			V._api._MagickImage_RemoveAttribute(this._instance, e);
		});
	}
	removeProfile(e) {
		E(typeof e == "string" ? e : e.name, (e) => {
			V._api._MagickImage_RemoveProfile(this._instance, e);
		});
	}
	removeWriteMask() {
		this.useExceptionPointer((e) => {
			V._api._MagickImage_SetWriteMask(this._instance, 0, e);
		});
	}
	resetPage() {
		this.page = new O(0, 0, 0, 0);
	}
	resize(e, t, n) {
		let r = this.filterType, i;
		typeof e == "number" ? (i = new O(e, t), n !== void 0 && (r = n)) : (i = e, t !== void 0 && (r = t)), this.useException((e) => {
			E(i.toString(), (t) => {
				let n = V._api._MagickImage_Resize(this._instance, t, r, e.ptr);
				this._setInstance(n, e);
			});
		});
	}
	roll(e, t) {
		this.useException((n) => {
			let r = V._api._MagickImage_Roll(this._instance, e, t, n.ptr);
			this._setInstance(r, n);
		});
	}
	rotate(e) {
		this.useException((t) => {
			let n = V._api._MagickImage_Rotate(this._instance, e, t.ptr);
			this._setInstance(n, t);
		});
	}
	separate(e, t) {
		return this.useException((n) => {
			let r, i = h.Undefined;
			if (typeof e == "number" && t !== void 0) i = e, r = t;
			else if (typeof e == "function") r = e;
			else throw new C("invalid arguments");
			let a = V._api._MagickImage_Separate(this._instance, i, n.ptr);
			return Fe._createFromImages(a, this._settings, (e) => r(e));
		});
	}
	sepiaTone(e = new L(80)) {
		this.useException((t) => {
			let n = typeof e == "number" ? new L(e) : e, r = V._api._MagickImage_SepiaTone(this._instance, n._toQuantum(), t.ptr);
			this._setInstance(r, t);
		});
	}
	setArtifact(e, t) {
		let n;
		n = typeof t == "string" ? t : typeof t == "boolean" ? this.fromBool(t).toString() : t.toString(), E(e, (e) => {
			E(n, (t) => {
				V._api._MagickImage_SetArtifact(this._instance, e, t);
			});
		});
	}
	setAttribute(e, t) {
		this.useException((n) => {
			E(e, (e) => {
				E(t, (t) => {
					V._api._MagickImage_SetAttribute(this._instance, e, t, n.ptr);
				});
			});
		});
	}
	setCompression(e) {
		V._api._MagickImage_Compression_Set(this._instance, e);
	}
	setProfile(e, t) {
		let n = typeof e == "string" ? e : e.name, r;
		t === void 0 ? typeof e != "string" && (r = e.data) : r = t, this.useException((e) => {
			E(n, (t) => {
				be(r, (n) => {
					V._api._MagickImage_SetProfile(this._instance, t, n, r.byteLength, e.ptr);
				});
			});
		});
	}
	setWriteMask(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_SetWriteMask(this._instance, e._instance, t);
		});
	}
	shadow(e, t, n, r, i) {
		let a, o = typeof e == "number" ? e : 5, s = this.valueOrDefault(t, 5), c = this.valueOrDefault(n, .5), l = this.valueOrDefault(r, new L(80)), u = typeof e == "number" ? i : e;
		u !== void 0 && (a = this.backgroundColor, this.backgroundColor = u);
		try {
			this.useException((e) => {
				let t = V._api._MagickImage_Shadow(this._instance, o, s, c, l.toDouble(), e.ptr);
				this._setInstance(t, e);
			});
		} finally {
			a !== void 0 && (this.backgroundColor = a);
		}
	}
	sharpen(e, t, n) {
		let r = this.valueOrDefault(e, 0), i = this.valueOrDefault(t, 1), a = this.valueOrDefault(n, h.Undefined);
		this.useException((e) => {
			let t = V._api._MagickImage_Sharpen(this._instance, r, i, a, e.ptr);
			this._setInstance(t, e);
		});
	}
	shave(e, t) {
		this.useException((n) => {
			let r = V._api._MagickImage_Shave(this._instance, e, t, n.ptr);
			this._setInstance(r, n);
		});
	}
	sigmoidalContrast(e, t, n) {
		this.sigmoidalContrastPrivate(!0, e, t, n);
	}
	solarize(e = new L(50)) {
		this.useException((t) => {
			let n = typeof e == "number" ? new L(e) : e;
			V._api._MagickImage_Solarize(this._instance, n._toQuantum(), t.ptr);
		});
	}
	splice(e, t) {
		let n = this.valueOrDefault(t, j.Undefined);
		E(e.toString(), (e) => {
			this.useException((t) => {
				let r = V._api._MagickImage_Splice(this._instance, e, n, t.ptr);
				this._setInstance(r, t);
			});
		});
	}
	statistics(e) {
		let t = this.valueOrDefault(e, h.All);
		return this.useExceptionPointer((e) => {
			let n = V._api._MagickImage_Statistics(this._instance, t, e), r = We._create(this, n, t);
			return V._api._Statistics_DisposeList(n), r;
		});
	}
	strip() {
		this.useExceptionPointer((e) => {
			V._api._MagickImage_Strip(this._instance, e);
		});
	}
	transformColorSpace(e, t, n) {
		let r = e, i, a = x.Quantum;
		t !== void 0 && (typeof t == "number" ? a = t : i = t), n !== void 0 && (a = n);
		let o = this.hasProfile("icc") || this.hasProfile("icm");
		if (i === void 0) {
			if (!o) return !1;
			i = r;
		} else {
			if (r.colorSpace !== this.colorSpace) return !1;
			o || this.setProfile(r);
		}
		return a === x.Quantum ? Pe.use(this, (e) => {
			e.setArtifact("profile:highres-transform", !1), this.setProfile(i);
		}) : this.setProfile(i), !0;
	}
	threshold(e, t) {
		let n = this.valueOrDefault(t, h.Undefined);
		this.useExceptionPointer((t) => {
			V._api._MagickImage_Threshold(this._instance, e._toQuantum(), n, t);
		});
	}
	thumbnail(e, t) {
		let n = typeof e == "number" ? new O(e, t) : e;
		this.useException((e) => {
			E(n.toString(), (t) => {
				let n = V._api._MagickImage_Thumbnail(this._instance, t, e.ptr);
				this._setInstance(n, e);
			});
		});
	}
	toString = () => `${this.format} ${this.width}x${this.height} ${this.depth}-bit ${ne[this.colorSpace]}`;
	transparent(e) {
		e._use((e) => {
			this.useExceptionPointer((t) => {
				V._api._MagickImage_Transparent(this._instance, e, 0, t);
			});
		});
	}
	trim(...e) {
		if (e.length > 0) if (e.length == 1 && e[0] instanceof L) {
			let t = e[0];
			this.setArtifact("trim:percent-background", t.toDouble().toString());
		} else {
			let t = [...new Set(Te(e))].join(",");
			this.setArtifact("trim:edges", t);
		}
		this.useException((e) => {
			let t = V._api._MagickImage_Trim(this._instance, e.ptr);
			this._setInstance(t, e), this.removeArtifact("trim:edges"), this.removeArtifact("trim:percent-background");
		});
	}
	wave(e, t, n) {
		let r = this.valueOrDefault(e, this.interpolate), i = this.valueOrDefault(t, 25), a = this.valueOrDefault(n, 150);
		this.useException((e) => {
			let t = V._api._MagickImage_Wave(this._instance, r, i, a, e.ptr);
			this._setInstance(t, e);
		});
	}
	vignette(e, t, n, r) {
		let i = this.valueOrDefault(e, 0), a = this.valueOrDefault(t, 1), o = this.valueOrDefault(n, 0), s = this.valueOrDefault(r, 0);
		this.useException((e) => {
			let t = V._api._MagickImage_Vignette(this._instance, i, a, o, s, e.ptr);
			this._setInstance(t, e);
		});
	}
	whiteThreshold(e, t) {
		let n = this.valueOrDefault(t, h.Composite);
		this.useException((t) => {
			E(e.toString(), (e) => {
				V._api._MagickImage_WhiteThreshold(this._instance, e, n, t.ptr);
			});
		});
	}
	write(e, t) {
		let n = 0, r = 0;
		t === void 0 ? t = e : this._settings.format = e, this.useException((e) => {
			_e.use((t) => {
				this._settings._use((i) => {
					try {
						n = V._api._MagickImage_WriteBlob(this._instance, i._instance, t.ptr, e.ptr), r = t.value;
					} catch (e) {
						throw n !== 0 && (n = V._api._MagickMemory_Relinquish(n)), e;
					}
				});
			});
		});
		let i = new he(n, r, t);
		return k._disposeAfterExecution(i, i.func);
	}
	writeToCanvas(e, t) {
		e.width = this.width, e.height = this.height;
		let n = e.getContext("2d", t);
		n !== null && R._map(this, "RGBA", (e) => {
			let t = n.createImageData(this.width, this.height), r = 0;
			for (let n = 0; n < this.height; n++) for (let n = 0; n < this.width; n++) t.data[r++] = V._api.HEAPU8[e++], t.data[r++] = V._api.HEAPU8[e++], t.data[r++] = V._api.HEAPU8[e++], t.data[r++] = V._api.HEAPU8[e++];
			n.putImageData(t, 0, 0);
		});
	}
	static _createFromImage(e, n) {
		return new t(e, n);
	}
	_channelOffset(e) {
		return V._api._MagickImage_HasChannel(this._instance, e) ? V._api._MagickImage_ChannelOffset(this._instance, e) : -1;
	}
	static _clone(e) {
		return A.usePointer((n) => new t(V._api._MagickImage_Clone(e._instance, n), e._settings._clone()));
	}
	_getSettings() {
		return this._settings;
	}
	_instanceNotInitialized() {
		throw new C("no image has been read");
	}
	_setInstance(e, t) {
		if (super._setInstance(e, t) === !0 || e === 0 && this.onProgress !== void 0) return !0;
		throw new C("out of memory");
	}
	_use(e) {
		return k._disposeAfterExecution(this, e);
	}
	static _create(e) {
		return t.create()._use(e);
	}
	onDispose() {
		this.disposeProgressDelegate();
	}
	contrastPrivate(e) {
		this.useExceptionPointer((t) => {
			V._api._MagickImage_Contrast(this._instance, this.fromBool(e), t);
		});
	}
	static createInstance() {
		return A.usePointer((e) => V._api._MagickImage_Create(0, e));
	}
	disposeProgressDelegate() {
		H.removeProgressDelegate(this), this._progress = void 0;
	}
	floodFillPrivate(e, n, r, i, a) {
		let o = i;
		o === void 0 && this.getPixels((e) => {
			let t = e.getColor(n, r);
			t !== null && (o = t);
		}), typeof e == "number" && o !== void 0 && (o.a = e), this.settings._drawing._use((i) => {
			e instanceof D ? (i.setFillColor(e), i.setFillPattern()) : e instanceof t && (i.setFillColor(), i.setFillPattern(e)), this.useExceptionPointer((e) => {
				o === void 0 ? V._api._MagickImage_FloodFill(this._instance, i._instance, n, r, 0, this.fromBool(a), e) : o._use((t) => {
					V._api._MagickImage_FloodFill(this._instance, i._instance, n, r, t, this.fromBool(a), e);
				});
			});
		});
	}
	fromBool(e) {
		return +!!e;
	}
	getProfilePrivate(e) {
		return E(e, (e) => {
			let t = V._api._MagickImage_GetProfile(this._instance, e), n = Ge.toArray(t);
			return n === null ? null : n;
		});
	}
	onSettingsArtifactChanged(e, t) {
		t === void 0 ? this.removeArtifact(e) : this.setArtifact(e, t);
	}
	opaquePrivate(e, t, n) {
		this.useExceptionPointer((r) => {
			e._use((e) => {
				t._use((t) => {
					V._api._MagickImage_Opaque(this._instance, e, t, this.fromBool(n), r);
				});
			});
		});
	}
	readOrPing(t, n, r, i) {
		this.useException((a) => {
			let o = r instanceof I ? r : new I(this._settings);
			if (o._ping = t, this._settings._ping = t, o.frameCount !== void 0 && o.frameCount > 1) throw new C("The frame count can only be set to 1 when a single image is being read.");
			if (typeof n == "string") o._fileName = n;
			else if (e(n)) {
				this.readFromArray(n, o, a);
				return;
			} else o._fileName = "xc:" + n.toShortString(), o.width = typeof r == "number" ? r : 0, o.height = typeof i == "number" ? i : 0;
			o._use((e) => {
				let t = V._api._MagickImage_ReadFile(e._instance, a.ptr);
				this._setInstance(t, a);
			});
		});
	}
	readFromArray(e, t, n) {
		t._use((t) => {
			be(e, (r) => {
				let i = V._api._MagickImage_ReadBlob(t._instance, r, 0, e.byteLength, n.ptr);
				this._setInstance(i, n);
			});
		});
	}
	sigmoidalContrastPrivate(e, t, n, r) {
		let i;
		i = n === void 0 ? w.max * .5 : typeof n == "number" ? n : n.multiply(w.max);
		let a = this.valueOrDefault(r, h.Undefined);
		this.useExceptionPointer((n) => {
			V._api._MagickImage_SigmoidalContrast(this._instance, this.fromBool(e), t, i, a, n);
		});
	}
	toBool(e) {
		return e === 1;
	}
	transparentPrivate(e, t) {
		e._use((e) => {
			this.useExceptionPointer((n) => {
				V._api._MagickImage_Transparent(this._instance, e, this.fromBool(t), n);
			});
		});
	}
	valueOrDefault(e, t) {
		return e === void 0 ? t : e;
	}
	valueOrComputedDefault(e, t) {
		return e === void 0 ? t() : e;
	}
	useException(e) {
		return A.use(e, (e) => {
			this.onWarning !== void 0 && this.onWarning(new Ke(e));
		});
	}
	useExceptionPointer(e) {
		return A.usePointer(e, (e) => {
			this.onWarning !== void 0 && this.onWarning(new Ke(e));
		});
	}
}, qe = (() => {
	var e = import.meta.url;
	return (async function(t = {}) {
		var n, r = t, i, a, o = new Promise((e, t) => {
			i = e, a = t;
		}), s = typeof window == "object", c = typeof WorkerGlobalScope < "u";
		typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type, (!globalThis.crypto || !globalThis.crypto.getRandomValues) && (globalThis.crypto = { getRandomValues: (e) => {
			for (let t = 0; t < e.length; t++) e[t] = Math.random() * 256 | 0;
		} });
		var l = "./this.program", u = (e, t) => {
			throw t;
		}, d = "";
		function f(e) {
			return r.locateFile ? r.locateFile(e, d) : d + e;
		}
		var p, ee;
		(s || c) && (c ? d = self.location.href : typeof document < "u" && document.currentScript && (d = document.currentScript.src), e && (d = e), d = d.startsWith("blob:") ? "" : d.slice(0, d.replace(/[?#].*/, "").lastIndexOf("/") + 1), c && (ee = (e) => {
			var t = new XMLHttpRequest();
			return t.open("GET", e, !1), t.responseType = "arraybuffer", t.send(null), new Uint8Array(t.response);
		}), p = async (e) => {
			if (C(e)) return new Promise((t, n) => {
				var r = new XMLHttpRequest();
				r.open("GET", e, !0), r.responseType = "arraybuffer", r.onload = () => {
					if (r.status == 200 || r.status == 0 && r.response) {
						t(r.response);
						return;
					}
					n(r.status);
				}, r.onerror = n, r.send(null);
			});
			var t = await fetch(e, { credentials: "same-origin" });
			if (t.ok) return t.arrayBuffer();
			throw Error(t.status + " : " + t.url);
		});
		var m = console.log.bind(console), h = console.error.bind(console), te, g, ne = !1, _, v, y, re, b, x, ie, S, ae, oe, C = (e) => e.startsWith("file://");
		function w() {
			var e = g.buffer;
			_ = new Int8Array(e), y = new Int16Array(e), r.HEAPU8 = v = new Uint8Array(e), re = new Uint16Array(e), b = new Int32Array(e), x = new Uint32Array(e), ie = new Float32Array(e), oe = new Float64Array(e), S = new BigInt64Array(e), ae = new BigUint64Array(e);
		}
		function T() {
			if (r.preRun) for (typeof r.preRun == "function" && (r.preRun = [r.preRun]); r.preRun.length;) Ce(r.preRun.shift());
			ye(Se);
		}
		function se() {
			!r.noFSInit && !W.initialized && W.init(), V.init(), Q.hb(), W.ignorePermissions = !1;
		}
		function ce() {
			if (r.postRun) for (typeof r.postRun == "function" && (r.postRun = [r.postRun]); r.postRun.length;) xe(r.postRun.shift());
			ye(be);
		}
		var E = 0, D = null;
		function le(e) {
			return e;
		}
		function O(e) {
			E++, r.monitorRunDependencies?.(E);
		}
		function ue(e) {
			if (E--, r.monitorRunDependencies?.(E), E == 0 && D) {
				var t = D;
				D = null, t();
			}
		}
		function de(e) {
			r.onAbort?.(e), e = "Aborted(" + e + ")", h(e), ne = !0, e += ". Build with -sASSERTIONS for more info.";
			var t = new WebAssembly.RuntimeError(e);
			throw a(t), t;
		}
		var fe;
		function pe() {
			return r.locateFile ? f("magick.wasm") : new URL("data:text/plain;base64,").href;
		}
		function me(e) {
			if (e == fe && te) return new Uint8Array(te);
			if (ee) return ee(e);
			throw "both async and sync fetching of the wasm failed";
		}
		async function k(e) {
			if (!te) try {
				var t = await p(e);
				return new Uint8Array(t);
			} catch {}
			return me(e);
		}
		async function he(e, t) {
			try {
				var n = await k(e);
				return await WebAssembly.instantiate(n, t);
			} catch (e) {
				h(`failed to asynchronously prepare wasm: ${e}`), de(e);
			}
		}
		async function ge(e, t, n) {
			if (!e && typeof WebAssembly.instantiateStreaming == "function" && !C(t)) try {
				var r = fetch(t, { credentials: "same-origin" });
				return await WebAssembly.instantiateStreaming(r, n);
			} catch (e) {
				h(`wasm streaming compile failed: ${e}`), h("falling back to ArrayBuffer instantiation");
			}
			return he(t, n);
		}
		function _e() {
			return { a: Oi };
		}
		async function A() {
			function e(e, t) {
				return Q = e.exports, Q = ya(Q), g = Q.gb, w(), ke = Q.Bb, ue("wasm-instantiate"), Q;
			}
			O("wasm-instantiate");
			function t(t) {
				return e(t.instance);
			}
			var n = _e();
			if (r.instantiateWasm) return new Promise((t, i) => {
				r.instantiateWasm(n, (n, r) => {
					t(e(n, r));
				});
			});
			fe ??= pe();
			try {
				return t(await ge(te, fe, n));
			} catch (e) {
				return a(e), Promise.reject(e);
			}
		}
		class ve {
			name = "ExitStatus";
			constructor(e) {
				this.message = `Program terminated with exit(${e})`, this.status = e;
			}
		}
		var ye = (e) => {
			for (; e.length > 0;) e.shift()(r);
		}, be = [], xe = (e) => be.push(e), Se = [], Ce = (e) => Se.push(e);
		function we(e, t = "i8") {
			switch (t.endsWith("*") && (t = "*"), t) {
				case "i1": return _[e >>> 0];
				case "i8": return _[e >>> 0];
				case "i16": return y[e >>> 1 >>> 0];
				case "i32": return b[e >>> 2 >>> 0];
				case "i64": return S[e >>> 3];
				case "float": return ie[e >>> 2 >>> 0];
				case "double": return oe[e >>> 3 >>> 0];
				case "*": return x[e >>> 2 >>> 0];
				default: de(`invalid type for getValue: ${t}`);
			}
		}
		var j = !0;
		function Te(e, t, n = "i8") {
			switch (n.endsWith("*") && (n = "*"), n) {
				case "i1":
					_[e >>> 0] = t;
					break;
				case "i8":
					_[e >>> 0] = t;
					break;
				case "i16":
					y[e >>> 1 >>> 0] = t;
					break;
				case "i32":
					b[e >>> 2 >>> 0] = t;
					break;
				case "i64":
					S[e >>> 3] = BigInt(t);
					break;
				case "float":
					ie[e >>> 2 >>> 0] = t;
					break;
				case "double":
					oe[e >>> 3 >>> 0] = t;
					break;
				case "*":
					x[e >>> 2 >>> 0] = t;
					break;
				default: de(`invalid type for setValue: ${n}`);
			}
		}
		var M = (e) => Pi(e), N = () => Fi(), Ee = 9007199254740992, De = -9007199254740992, P = (e) => e < De || e > Ee ? NaN : Number(e), Oe = [], ke, F = (e) => {
			var t = Oe[e];
			return t || (Oe[e] = t = ke.get(e)), t;
		};
		function Ae(e, t) {
			return e >>>= 0, F(e)(t);
		}
		var I = [], je = 0;
		function Me(e) {
			e >>>= 0;
			var t = new Fe(e);
			return t.get_caught() || (t.set_caught(!0), je--), t.set_rethrown(!1), I.push(t), Li(e), zi(e);
		}
		var Ne = 0, Pe = () => {
			$(0, 0), Ii(I.pop().excPtr), Ne = 0;
		};
		class Fe {
			constructor(e) {
				this.excPtr = e, this.ptr = e - 24;
			}
			set_type(e) {
				x[this.ptr + 4 >>> 2 >>> 0] = e;
			}
			get_type() {
				return x[this.ptr + 4 >>> 2 >>> 0];
			}
			set_destructor(e) {
				x[this.ptr + 8 >>> 2 >>> 0] = e;
			}
			get_destructor() {
				return x[this.ptr + 8 >>> 2 >>> 0];
			}
			set_caught(e) {
				e = +!!e, _[this.ptr + 12 >>> 0] = e;
			}
			get_caught() {
				return _[this.ptr + 12 >>> 0] != 0;
			}
			set_rethrown(e) {
				e = +!!e, _[this.ptr + 13 >>> 0] = e;
			}
			get_rethrown() {
				return _[this.ptr + 13 >>> 0] != 0;
			}
			init(e, t) {
				this.set_adjusted_ptr(0), this.set_type(e), this.set_destructor(t);
			}
			set_adjusted_ptr(e) {
				x[this.ptr + 16 >>> 2 >>> 0] = e;
			}
			get_adjusted_ptr() {
				return x[this.ptr + 16 >>> 2 >>> 0];
			}
		}
		var L = (e) => Ni(e), Ie = (e) => {
			var t = Ne;
			if (!t) return L(0), 0;
			var n = new Fe(t);
			n.set_adjusted_ptr(t);
			var r = n.get_type();
			if (!r) return L(0), t;
			for (var i of e) {
				if (i === 0 || i === r) break;
				if (Ri(i, r, n.ptr + 16)) return L(i), t;
			}
			return L(r), t;
		};
		function Le() {
			return Ie([]);
		}
		function Re(e) {
			return e >>>= 0, Ie([e]);
		}
		function ze(e, t, n) {
			throw e >>>= 0, t >>>= 0, n >>>= 0, new Fe(e).init(t, n), Ne = e, je++, Ne;
		}
		function Be(e) {
			throw e >>>= 0, Ne ||= e, Ne;
		}
		var R = {
			isAbs: (e) => e.charAt(0) === "/",
			splitPath: (e) => /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(e).slice(1),
			normalizeArray: (e, t) => {
				for (var n = 0, r = e.length - 1; r >= 0; r--) {
					var i = e[r];
					i === "." ? e.splice(r, 1) : i === ".." ? (e.splice(r, 1), n++) : n && (e.splice(r, 1), n--);
				}
				if (t) for (; n; n--) e.unshift("..");
				return e;
			},
			normalize: (e) => {
				var t = R.isAbs(e), n = e.slice(-1) === "/";
				return e = R.normalizeArray(e.split("/").filter((e) => !!e), !t).join("/"), !e && !t && (e = "."), e && n && (e += "/"), (t ? "/" : "") + e;
			},
			dirname: (e) => {
				var t = R.splitPath(e), n = t[0], r = t[1];
				return !n && !r ? "." : (r &&= r.slice(0, -1), n + r);
			},
			basename: (e) => e && e.match(/([^\/]+|\/)\/*$/)[1],
			join: (...e) => R.normalize(e.join("/")),
			join2: (e, t) => R.normalize(e + "/" + t)
		}, Ve = () => (e) => crypto.getRandomValues(e), He = (e) => {
			(He = Ve())(e);
		}, z = {
			resolve: (...e) => {
				for (var t = "", n = !1, r = e.length - 1; r >= -1 && !n; r--) {
					var i = r >= 0 ? e[r] : W.cwd();
					if (typeof i != "string") throw TypeError("Arguments to path.resolve must be strings");
					if (!i) return "";
					t = i + "/" + t, n = R.isAbs(i);
				}
				return t = R.normalizeArray(t.split("/").filter((e) => !!e), !n).join("/"), (n ? "/" : "") + t || ".";
			},
			relative: (e, t) => {
				e = z.resolve(e).slice(1), t = z.resolve(t).slice(1);
				function n(e) {
					for (var t = 0; t < e.length && e[t] === ""; t++);
					for (var n = e.length - 1; n >= 0 && e[n] === ""; n--);
					return t > n ? [] : e.slice(t, n - t + 1);
				}
				for (var r = n(e.split("/")), i = n(t.split("/")), a = Math.min(r.length, i.length), o = a, s = 0; s < a; s++) if (r[s] !== i[s]) {
					o = s;
					break;
				}
				for (var c = [], s = o; s < r.length; s++) c.push("..");
				return c = c.concat(i.slice(o)), c.join("/");
			}
		}, Ue = typeof TextDecoder < "u" ? new TextDecoder() : void 0, We = (e, t = 0, n = NaN) => {
			t >>>= 0;
			for (var r = t + n, i = t; e[i] && !(i >= r);) ++i;
			if (i - t > 16 && e.buffer && Ue) return Ue.decode(e.subarray(t, i));
			for (var a = ""; t < i;) {
				var o = e[t++];
				if (!(o & 128)) {
					a += String.fromCharCode(o);
					continue;
				}
				var s = e[t++] & 63;
				if ((o & 224) == 192) {
					a += String.fromCharCode((o & 31) << 6 | s);
					continue;
				}
				var c = e[t++] & 63;
				if (o = (o & 240) == 224 ? (o & 15) << 12 | s << 6 | c : (o & 7) << 18 | s << 12 | c << 6 | e[t++] & 63, o < 65536) a += String.fromCharCode(o);
				else {
					var l = o - 65536;
					a += String.fromCharCode(55296 | l >> 10, 56320 | l & 1023);
				}
			}
			return a;
		}, Ge = [], Ke = (e) => {
			for (var t = 0, n = 0; n < e.length; ++n) {
				var r = e.charCodeAt(n);
				r <= 127 ? t++ : r <= 2047 ? t += 2 : r >= 55296 && r <= 57343 ? (t += 4, ++n) : t += 3;
			}
			return t;
		}, B = (e, t, n, r) => {
			if (n >>>= 0, !(r > 0)) return 0;
			for (var i = n, a = n + r - 1, o = 0; o < e.length; ++o) {
				var s = e.charCodeAt(o);
				if (s >= 55296 && s <= 57343) {
					var c = e.charCodeAt(++o);
					s = 65536 + ((s & 1023) << 10) | c & 1023;
				}
				if (s <= 127) {
					if (n >= a) break;
					t[n++ >>> 0] = s;
				} else if (s <= 2047) {
					if (n + 1 >= a) break;
					t[n++ >>> 0] = 192 | s >> 6, t[n++ >>> 0] = 128 | s & 63;
				} else if (s <= 65535) {
					if (n + 2 >= a) break;
					t[n++ >>> 0] = 224 | s >> 12, t[n++ >>> 0] = 128 | s >> 6 & 63, t[n++ >>> 0] = 128 | s & 63;
				} else {
					if (n + 3 >= a) break;
					t[n++ >>> 0] = 240 | s >> 18, t[n++ >>> 0] = 128 | s >> 12 & 63, t[n++ >>> 0] = 128 | s >> 6 & 63, t[n++ >>> 0] = 128 | s & 63;
				}
			}
			return t[n >>> 0] = 0, n - i;
		}, qe = (e, t, n) => {
			var r = n > 0 ? n : Ke(e) + 1, i = Array(r), a = B(e, i, 0, i.length);
			return t && (i.length = a), i;
		}, Je = () => {
			if (!Ge.length) {
				var e = null;
				if (typeof window < "u" && typeof window.prompt == "function" && (e = window.prompt("Input: "), e !== null && (e += "\n")), !e) return null;
				Ge = qe(e, !0);
			}
			return Ge.shift();
		}, V = {
			ttys: [],
			init() {},
			shutdown() {},
			register(e, t) {
				V.ttys[e] = {
					input: [],
					output: [],
					ops: t
				}, W.registerDevice(e, V.stream_ops);
			},
			stream_ops: {
				open(e) {
					var t = V.ttys[e.node.rdev];
					if (!t) throw new W.ErrnoError(43);
					e.tty = t, e.seekable = !1;
				},
				close(e) {
					e.tty.ops.fsync(e.tty);
				},
				fsync(e) {
					e.tty.ops.fsync(e.tty);
				},
				read(e, t, n, r, i) {
					if (!e.tty || !e.tty.ops.get_char) throw new W.ErrnoError(60);
					for (var a = 0, o = 0; o < r; o++) {
						var s;
						try {
							s = e.tty.ops.get_char(e.tty);
						} catch {
							throw new W.ErrnoError(29);
						}
						if (s === void 0 && a === 0) throw new W.ErrnoError(6);
						if (s == null) break;
						a++, t[n + o] = s;
					}
					return a && (e.node.atime = Date.now()), a;
				},
				write(e, t, n, r, i) {
					if (!e.tty || !e.tty.ops.put_char) throw new W.ErrnoError(60);
					try {
						for (var a = 0; a < r; a++) e.tty.ops.put_char(e.tty, t[n + a]);
					} catch {
						throw new W.ErrnoError(29);
					}
					return r && (e.node.mtime = e.node.ctime = Date.now()), a;
				}
			},
			default_tty_ops: {
				get_char(e) {
					return Je();
				},
				put_char(e, t) {
					t === null || t === 10 ? (m(We(e.output)), e.output = []) : t != 0 && e.output.push(t);
				},
				fsync(e) {
					e.output?.length > 0 && (m(We(e.output)), e.output = []);
				},
				ioctl_tcgets(e) {
					return {
						c_iflag: 25856,
						c_oflag: 5,
						c_cflag: 191,
						c_lflag: 35387,
						c_cc: [
							3,
							28,
							127,
							21,
							4,
							0,
							1,
							0,
							17,
							19,
							26,
							0,
							18,
							15,
							23,
							22,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0,
							0
						]
					};
				},
				ioctl_tcsets(e, t, n) {
					return 0;
				},
				ioctl_tiocgwinsz(e) {
					return [24, 80];
				}
			},
			default_tty1_ops: {
				put_char(e, t) {
					t === null || t === 10 ? (h(We(e.output)), e.output = []) : t != 0 && e.output.push(t);
				},
				fsync(e) {
					e.output?.length > 0 && (h(We(e.output)), e.output = []);
				}
			}
		}, Ye = (e, t) => v.fill(0, e, e + t), Xe = (e, t) => Math.ceil(e / t) * t, Ze = (e) => {
			e = Xe(e, 65536);
			var t = Mi(65536, e);
			return t && Ye(t, e), t;
		}, H = {
			ops_table: null,
			mount(e) {
				return H.createNode(null, "/", 16895, 0);
			},
			createNode(e, t, n, r) {
				if (W.isBlkdev(n) || W.isFIFO(n)) throw new W.ErrnoError(63);
				H.ops_table ||= {
					dir: {
						node: {
							getattr: H.node_ops.getattr,
							setattr: H.node_ops.setattr,
							lookup: H.node_ops.lookup,
							mknod: H.node_ops.mknod,
							rename: H.node_ops.rename,
							unlink: H.node_ops.unlink,
							rmdir: H.node_ops.rmdir,
							readdir: H.node_ops.readdir,
							symlink: H.node_ops.symlink
						},
						stream: { llseek: H.stream_ops.llseek }
					},
					file: {
						node: {
							getattr: H.node_ops.getattr,
							setattr: H.node_ops.setattr
						},
						stream: {
							llseek: H.stream_ops.llseek,
							read: H.stream_ops.read,
							write: H.stream_ops.write,
							mmap: H.stream_ops.mmap,
							msync: H.stream_ops.msync
						}
					},
					link: {
						node: {
							getattr: H.node_ops.getattr,
							setattr: H.node_ops.setattr,
							readlink: H.node_ops.readlink
						},
						stream: {}
					},
					chrdev: {
						node: {
							getattr: H.node_ops.getattr,
							setattr: H.node_ops.setattr
						},
						stream: W.chrdev_stream_ops
					}
				};
				var i = W.createNode(e, t, n, r);
				return W.isDir(i.mode) ? (i.node_ops = H.ops_table.dir.node, i.stream_ops = H.ops_table.dir.stream, i.contents = {}) : W.isFile(i.mode) ? (i.node_ops = H.ops_table.file.node, i.stream_ops = H.ops_table.file.stream, i.usedBytes = 0, i.contents = null) : W.isLink(i.mode) ? (i.node_ops = H.ops_table.link.node, i.stream_ops = H.ops_table.link.stream) : W.isChrdev(i.mode) && (i.node_ops = H.ops_table.chrdev.node, i.stream_ops = H.ops_table.chrdev.stream), i.atime = i.mtime = i.ctime = Date.now(), e && (e.contents[t] = i, e.atime = e.mtime = e.ctime = i.atime), i;
			},
			getFileDataAsTypedArray(e) {
				return e.contents ? e.contents.subarray ? e.contents.subarray(0, e.usedBytes) : new Uint8Array(e.contents) : new Uint8Array();
			},
			expandFileStorage(e, t) {
				var n = e.contents ? e.contents.length : 0;
				if (!(n >= t)) {
					t = Math.max(t, n * (n < 1024 * 1024 ? 2 : 1.125) >>> 0), n != 0 && (t = Math.max(t, 256));
					var r = e.contents;
					e.contents = new Uint8Array(t), e.usedBytes > 0 && e.contents.set(r.subarray(0, e.usedBytes), 0);
				}
			},
			resizeFileStorage(e, t) {
				if (e.usedBytes != t) if (t == 0) e.contents = null, e.usedBytes = 0;
				else {
					var n = e.contents;
					e.contents = new Uint8Array(t), n && e.contents.set(n.subarray(0, Math.min(t, e.usedBytes))), e.usedBytes = t;
				}
			},
			node_ops: {
				getattr(e) {
					var t = {};
					return t.dev = W.isChrdev(e.mode) ? e.id : 1, t.ino = e.id, t.mode = e.mode, t.nlink = 1, t.uid = 0, t.gid = 0, t.rdev = e.rdev, W.isDir(e.mode) ? t.size = 4096 : W.isFile(e.mode) ? t.size = e.usedBytes : W.isLink(e.mode) ? t.size = e.link.length : t.size = 0, t.atime = new Date(e.atime), t.mtime = new Date(e.mtime), t.ctime = new Date(e.ctime), t.blksize = 4096, t.blocks = Math.ceil(t.size / t.blksize), t;
				},
				setattr(e, t) {
					for (let n of [
						"mode",
						"atime",
						"mtime",
						"ctime"
					]) t[n] != null && (e[n] = t[n]);
					t.size !== void 0 && H.resizeFileStorage(e, t.size);
				},
				lookup(e, t) {
					throw H.doesNotExistError;
				},
				mknod(e, t, n, r) {
					return H.createNode(e, t, n, r);
				},
				rename(e, t, n) {
					var r;
					try {
						r = W.lookupNode(t, n);
					} catch {}
					if (r) {
						if (W.isDir(e.mode)) for (var i in r.contents) throw new W.ErrnoError(55);
						W.hashRemoveNode(r);
					}
					delete e.parent.contents[e.name], t.contents[n] = e, e.name = n, t.ctime = t.mtime = e.parent.ctime = e.parent.mtime = Date.now();
				},
				unlink(e, t) {
					delete e.contents[t], e.ctime = e.mtime = Date.now();
				},
				rmdir(e, t) {
					for (var n in W.lookupNode(e, t).contents) throw new W.ErrnoError(55);
					delete e.contents[t], e.ctime = e.mtime = Date.now();
				},
				readdir(e) {
					return [
						".",
						"..",
						...Object.keys(e.contents)
					];
				},
				symlink(e, t, n) {
					var r = H.createNode(e, t, 41471, 0);
					return r.link = n, r;
				},
				readlink(e) {
					if (!W.isLink(e.mode)) throw new W.ErrnoError(28);
					return e.link;
				}
			},
			stream_ops: {
				read(e, t, n, r, i) {
					var a = e.node.contents;
					if (i >= e.node.usedBytes) return 0;
					var o = Math.min(e.node.usedBytes - i, r);
					if (o > 8 && a.subarray) t.set(a.subarray(i, i + o), n);
					else for (var s = 0; s < o; s++) t[n + s] = a[i + s];
					return o;
				},
				write(e, t, n, r, i, a) {
					if (t.buffer === _.buffer && (a = !1), !r) return 0;
					var o = e.node;
					if (o.mtime = o.ctime = Date.now(), t.subarray && (!o.contents || o.contents.subarray)) {
						if (a) return o.contents = t.subarray(n, n + r), o.usedBytes = r, r;
						if (o.usedBytes === 0 && i === 0) return o.contents = t.slice(n, n + r), o.usedBytes = r, r;
						if (i + r <= o.usedBytes) return o.contents.set(t.subarray(n, n + r), i), r;
					}
					if (H.expandFileStorage(o, i + r), o.contents.subarray && t.subarray) o.contents.set(t.subarray(n, n + r), i);
					else for (var s = 0; s < r; s++) o.contents[i + s] = t[n + s];
					return o.usedBytes = Math.max(o.usedBytes, i + r), r;
				},
				llseek(e, t, n) {
					var r = t;
					if (n === 1 ? r += e.position : n === 2 && W.isFile(e.node.mode) && (r += e.node.usedBytes), r < 0) throw new W.ErrnoError(28);
					return r;
				},
				mmap(e, t, n, r, i) {
					if (!W.isFile(e.node.mode)) throw new W.ErrnoError(43);
					var a, o, s = e.node.contents;
					if (!(i & 2) && s && s.buffer === _.buffer) o = !1, a = s.byteOffset;
					else {
						if (o = !0, a = Ze(t), !a) throw new W.ErrnoError(48);
						s && ((n > 0 || n + t < s.length) && (s = s.subarray ? s.subarray(n, n + t) : Array.prototype.slice.call(s, n, n + t)), _.set(s, a >>> 0));
					}
					return {
						ptr: a,
						allocated: o
					};
				},
				msync(e, t, n, r, i) {
					return H.stream_ops.write(e, t, 0, r, n, !1), 0;
				}
			}
		}, Qe = async (e) => {
			var t = await p(e);
			return new Uint8Array(t);
		}, U = (e, t, n, r, i, a) => {
			W.createDataFile(e, t, n, r, i, a);
		}, $e = [], et = (e, t, n, r) => {
			typeof Browser < "u" && Browser.init();
			var i = !1;
			return $e.forEach((a) => {
				i || a.canHandle(t) && (a.handle(e, t, n, r), i = !0);
			}), i;
		}, tt = (e, t, n, r, i, a, o, s, c, l) => {
			var u = t ? z.resolve(R.join2(e, t)) : e, d = le(`cp ${u}`);
			function f(n) {
				function f(n) {
					l?.(), s || U(e, t, n, r, i, c), a?.(), ue(d);
				}
				et(n, u, f, () => {
					o?.(), ue(d);
				}) || f(n);
			}
			O(d), typeof n == "string" ? Qe(n).then(f, o) : f(n);
		}, nt = (e) => {
			var t = {
				r: 0,
				"r+": 2,
				w: 577,
				"w+": 578,
				a: 1089,
				"a+": 1090
			}[e];
			if (t === void 0) throw Error(`Unknown file open mode: ${e}`);
			return t;
		}, rt = (e, t) => {
			var n = 0;
			return e && (n |= 365), t && (n |= 146), n;
		}, W = {
			root: null,
			mounts: [],
			devices: {},
			streams: [],
			nextInode: 1,
			nameTable: null,
			currentPath: "/",
			initialized: !1,
			ignorePermissions: !0,
			filesystems: null,
			syncFSRequests: 0,
			readFiles: {},
			ErrnoError: class {
				name = "ErrnoError";
				constructor(e) {
					this.errno = e;
				}
			},
			FSStream: class {
				shared = {};
				get object() {
					return this.node;
				}
				set object(e) {
					this.node = e;
				}
				get isRead() {
					return (this.flags & 2097155) != 1;
				}
				get isWrite() {
					return (this.flags & 2097155) != 0;
				}
				get isAppend() {
					return this.flags & 1024;
				}
				get flags() {
					return this.shared.flags;
				}
				set flags(e) {
					this.shared.flags = e;
				}
				get position() {
					return this.shared.position;
				}
				set position(e) {
					this.shared.position = e;
				}
			},
			FSNode: class {
				node_ops = {};
				stream_ops = {};
				readMode = 365;
				writeMode = 146;
				mounted = null;
				constructor(e, t, n, r) {
					e ||= this, this.parent = e, this.mount = e.mount, this.id = W.nextInode++, this.name = t, this.mode = n, this.rdev = r, this.atime = this.mtime = this.ctime = Date.now();
				}
				get read() {
					return (this.mode & this.readMode) === this.readMode;
				}
				set read(e) {
					e ? this.mode |= this.readMode : this.mode &= ~this.readMode;
				}
				get write() {
					return (this.mode & this.writeMode) === this.writeMode;
				}
				set write(e) {
					e ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
				}
				get isFolder() {
					return W.isDir(this.mode);
				}
				get isDevice() {
					return W.isChrdev(this.mode);
				}
			},
			lookupPath(e, t = {}) {
				if (!e) throw new W.ErrnoError(44);
				t.follow_mount ??= !0, R.isAbs(e) || (e = W.cwd() + "/" + e);
				linkloop: for (var n = 0; n < 40; n++) {
					for (var r = e.split("/").filter((e) => !!e), i = W.root, a = "/", o = 0; o < r.length; o++) {
						var s = o === r.length - 1;
						if (s && t.parent) break;
						if (r[o] !== ".") {
							if (r[o] === "..") {
								if (a = R.dirname(a), W.isRoot(i)) {
									e = a + "/" + r.slice(o + 1).join("/");
									continue linkloop;
								} else i = i.parent;
								continue;
							}
							a = R.join2(a, r[o]);
							try {
								i = W.lookupNode(i, r[o]);
							} catch (e) {
								if (e?.errno === 44 && s && t.noent_okay) return { path: a };
								throw e;
							}
							if (W.isMountpoint(i) && (!s || t.follow_mount) && (i = i.mounted.root), W.isLink(i.mode) && (!s || t.follow)) {
								if (!i.node_ops.readlink) throw new W.ErrnoError(52);
								var c = i.node_ops.readlink(i);
								R.isAbs(c) || (c = R.dirname(a) + "/" + c), e = c + "/" + r.slice(o + 1).join("/");
								continue linkloop;
							}
						}
					}
					return {
						path: a,
						node: i
					};
				}
				throw new W.ErrnoError(32);
			},
			getPath(e) {
				for (var t;;) {
					if (W.isRoot(e)) {
						var n = e.mount.mountpoint;
						return t ? n[n.length - 1] === "/" ? n + t : `${n}/${t}` : n;
					}
					t = t ? `${e.name}/${t}` : e.name, e = e.parent;
				}
			},
			hashName(e, t) {
				for (var n = 0, r = 0; r < t.length; r++) n = (n << 5) - n + t.charCodeAt(r) | 0;
				return (e + n >>> 0) % W.nameTable.length;
			},
			hashAddNode(e) {
				var t = W.hashName(e.parent.id, e.name);
				e.name_next = W.nameTable[t], W.nameTable[t] = e;
			},
			hashRemoveNode(e) {
				var t = W.hashName(e.parent.id, e.name);
				if (W.nameTable[t] === e) W.nameTable[t] = e.name_next;
				else for (var n = W.nameTable[t]; n;) {
					if (n.name_next === e) {
						n.name_next = e.name_next;
						break;
					}
					n = n.name_next;
				}
			},
			lookupNode(e, t) {
				var n = W.mayLookup(e);
				if (n) throw new W.ErrnoError(n);
				for (var r = W.hashName(e.id, t), i = W.nameTable[r]; i; i = i.name_next) {
					var a = i.name;
					if (i.parent.id === e.id && a === t) return i;
				}
				return W.lookup(e, t);
			},
			createNode(e, t, n, r) {
				var i = new W.FSNode(e, t, n, r);
				return W.hashAddNode(i), i;
			},
			destroyNode(e) {
				W.hashRemoveNode(e);
			},
			isRoot(e) {
				return e === e.parent;
			},
			isMountpoint(e) {
				return !!e.mounted;
			},
			isFile(e) {
				return (e & 61440) == 32768;
			},
			isDir(e) {
				return (e & 61440) == 16384;
			},
			isLink(e) {
				return (e & 61440) == 40960;
			},
			isChrdev(e) {
				return (e & 61440) == 8192;
			},
			isBlkdev(e) {
				return (e & 61440) == 24576;
			},
			isFIFO(e) {
				return (e & 61440) == 4096;
			},
			isSocket(e) {
				return (e & 49152) == 49152;
			},
			flagsToPermissionString(e) {
				var t = [
					"r",
					"w",
					"rw"
				][e & 3];
				return e & 512 && (t += "w"), t;
			},
			nodePermissions(e, t) {
				return W.ignorePermissions ? 0 : t.includes("r") && !(e.mode & 292) || t.includes("w") && !(e.mode & 146) || t.includes("x") && !(e.mode & 73) ? 2 : 0;
			},
			mayLookup(e) {
				return W.isDir(e.mode) ? W.nodePermissions(e, "x") || (e.node_ops.lookup ? 0 : 2) : 54;
			},
			mayCreate(e, t) {
				if (!W.isDir(e.mode)) return 54;
				try {
					return W.lookupNode(e, t), 20;
				} catch {}
				return W.nodePermissions(e, "wx");
			},
			mayDelete(e, t, n) {
				var r;
				try {
					r = W.lookupNode(e, t);
				} catch (e) {
					return e.errno;
				}
				var i = W.nodePermissions(e, "wx");
				if (i) return i;
				if (n) {
					if (!W.isDir(r.mode)) return 54;
					if (W.isRoot(r) || W.getPath(r) === W.cwd()) return 10;
				} else if (W.isDir(r.mode)) return 31;
				return 0;
			},
			mayOpen(e, t) {
				return e ? W.isLink(e.mode) ? 32 : W.isDir(e.mode) && (W.flagsToPermissionString(t) !== "r" || t & 576) ? 31 : W.nodePermissions(e, W.flagsToPermissionString(t)) : 44;
			},
			checkOpExists(e, t) {
				if (!e) throw new W.ErrnoError(t);
				return e;
			},
			MAX_OPEN_FDS: 4096,
			nextfd() {
				for (var e = 0; e <= W.MAX_OPEN_FDS; e++) if (!W.streams[e]) return e;
				throw new W.ErrnoError(33);
			},
			getStreamChecked(e) {
				var t = W.getStream(e);
				if (!t) throw new W.ErrnoError(8);
				return t;
			},
			getStream: (e) => W.streams[e],
			createStream(e, t = -1) {
				return e = Object.assign(new W.FSStream(), e), t == -1 && (t = W.nextfd()), e.fd = t, W.streams[t] = e, e;
			},
			closeStream(e) {
				W.streams[e] = null;
			},
			dupStream(e, t = -1) {
				var n = W.createStream(e, t);
				return n.stream_ops?.dup?.(n), n;
			},
			doSetAttr(e, t, n) {
				var r = e?.stream_ops.setattr, i = r ? e : t;
				r ??= t.node_ops.setattr, W.checkOpExists(r, 63), r(i, n);
			},
			chrdev_stream_ops: {
				open(e) {
					e.stream_ops = W.getDevice(e.node.rdev).stream_ops, e.stream_ops.open?.(e);
				},
				llseek() {
					throw new W.ErrnoError(70);
				}
			},
			major: (e) => e >> 8,
			minor: (e) => e & 255,
			makedev: (e, t) => e << 8 | t,
			registerDevice(e, t) {
				W.devices[e] = { stream_ops: t };
			},
			getDevice: (e) => W.devices[e],
			getMounts(e) {
				for (var t = [], n = [e]; n.length;) {
					var r = n.pop();
					t.push(r), n.push(...r.mounts);
				}
				return t;
			},
			syncfs(e, t) {
				typeof e == "function" && (t = e, e = !1), W.syncFSRequests++, W.syncFSRequests > 1 && h(`warning: ${W.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
				var n = W.getMounts(W.root.mount), r = 0;
				function i(e) {
					return W.syncFSRequests--, t(e);
				}
				function a(e) {
					if (e) return a.errored ? void 0 : (a.errored = !0, i(e));
					++r >= n.length && i(null);
				}
				n.forEach((t) => {
					if (!t.type.syncfs) return a(null);
					t.type.syncfs(t, e, a);
				});
			},
			mount(e, t, n) {
				var r = n === "/", i = !n, a;
				if (r && W.root) throw new W.ErrnoError(10);
				if (!r && !i) {
					var o = W.lookupPath(n, { follow_mount: !1 });
					if (n = o.path, a = o.node, W.isMountpoint(a)) throw new W.ErrnoError(10);
					if (!W.isDir(a.mode)) throw new W.ErrnoError(54);
				}
				var s = {
					type: e,
					opts: t,
					mountpoint: n,
					mounts: []
				}, c = e.mount(s);
				return c.mount = s, s.root = c, r ? W.root = c : a && (a.mounted = s, a.mount && a.mount.mounts.push(s)), c;
			},
			unmount(e) {
				var t = W.lookupPath(e, { follow_mount: !1 });
				if (!W.isMountpoint(t.node)) throw new W.ErrnoError(28);
				var n = t.node, r = n.mounted, i = W.getMounts(r);
				Object.keys(W.nameTable).forEach((e) => {
					for (var t = W.nameTable[e]; t;) {
						var n = t.name_next;
						i.includes(t.mount) && W.destroyNode(t), t = n;
					}
				}), n.mounted = null;
				var a = n.mount.mounts.indexOf(r);
				n.mount.mounts.splice(a, 1);
			},
			lookup(e, t) {
				return e.node_ops.lookup(e, t);
			},
			mknod(e, t, n) {
				var r = W.lookupPath(e, { parent: !0 }).node, i = R.basename(e);
				if (!i) throw new W.ErrnoError(28);
				if (i === "." || i === "..") throw new W.ErrnoError(20);
				var a = W.mayCreate(r, i);
				if (a) throw new W.ErrnoError(a);
				if (!r.node_ops.mknod) throw new W.ErrnoError(63);
				return r.node_ops.mknod(r, i, t, n);
			},
			statfs(e) {
				return W.statfsNode(W.lookupPath(e, { follow: !0 }).node);
			},
			statfsStream(e) {
				return W.statfsNode(e.node);
			},
			statfsNode(e) {
				var t = {
					bsize: 4096,
					frsize: 4096,
					blocks: 1e6,
					bfree: 5e5,
					bavail: 5e5,
					files: W.nextInode,
					ffree: W.nextInode - 1,
					fsid: 42,
					flags: 2,
					namelen: 255
				};
				return e.node_ops.statfs && Object.assign(t, e.node_ops.statfs(e.mount.opts.root)), t;
			},
			create(e, t = 438) {
				return t &= 4095, t |= 32768, W.mknod(e, t, 0);
			},
			mkdir(e, t = 511) {
				return t &= 1023, t |= 16384, W.mknod(e, t, 0);
			},
			mkdirTree(e, t) {
				var n = e.split("/"), r = "";
				for (var i of n) if (i) {
					(r || R.isAbs(e)) && (r += "/"), r += i;
					try {
						W.mkdir(r, t);
					} catch (e) {
						if (e.errno != 20) throw e;
					}
				}
			},
			mkdev(e, t, n) {
				return n === void 0 && (n = t, t = 438), t |= 8192, W.mknod(e, t, n);
			},
			symlink(e, t) {
				if (!z.resolve(e)) throw new W.ErrnoError(44);
				var n = W.lookupPath(t, { parent: !0 }).node;
				if (!n) throw new W.ErrnoError(44);
				var r = R.basename(t), i = W.mayCreate(n, r);
				if (i) throw new W.ErrnoError(i);
				if (!n.node_ops.symlink) throw new W.ErrnoError(63);
				return n.node_ops.symlink(n, r, e);
			},
			rename(e, t) {
				var n = R.dirname(e), r = R.dirname(t), i = R.basename(e), a = R.basename(t), o = W.lookupPath(e, { parent: !0 }), s = o.node, c;
				if (o = W.lookupPath(t, { parent: !0 }), c = o.node, !s || !c) throw new W.ErrnoError(44);
				if (s.mount !== c.mount) throw new W.ErrnoError(75);
				var l = W.lookupNode(s, i), u = z.relative(e, r);
				if (u.charAt(0) !== ".") throw new W.ErrnoError(28);
				if (u = z.relative(t, n), u.charAt(0) !== ".") throw new W.ErrnoError(55);
				var d;
				try {
					d = W.lookupNode(c, a);
				} catch {}
				if (l !== d) {
					var f = W.isDir(l.mode), p = W.mayDelete(s, i, f);
					if (p || (p = d ? W.mayDelete(c, a, f) : W.mayCreate(c, a), p)) throw new W.ErrnoError(p);
					if (!s.node_ops.rename) throw new W.ErrnoError(63);
					if (W.isMountpoint(l) || d && W.isMountpoint(d)) throw new W.ErrnoError(10);
					if (c !== s && (p = W.nodePermissions(s, "w"), p)) throw new W.ErrnoError(p);
					W.hashRemoveNode(l);
					try {
						s.node_ops.rename(l, c, a), l.parent = c;
					} catch (e) {
						throw e;
					} finally {
						W.hashAddNode(l);
					}
				}
			},
			rmdir(e) {
				var t = W.lookupPath(e, { parent: !0 }).node, n = R.basename(e), r = W.lookupNode(t, n), i = W.mayDelete(t, n, !0);
				if (i) throw new W.ErrnoError(i);
				if (!t.node_ops.rmdir) throw new W.ErrnoError(63);
				if (W.isMountpoint(r)) throw new W.ErrnoError(10);
				t.node_ops.rmdir(t, n), W.destroyNode(r);
			},
			readdir(e) {
				var t = W.lookupPath(e, { follow: !0 }).node;
				return W.checkOpExists(t.node_ops.readdir, 54)(t);
			},
			unlink(e) {
				var t = W.lookupPath(e, { parent: !0 }).node;
				if (!t) throw new W.ErrnoError(44);
				var n = R.basename(e), r = W.lookupNode(t, n), i = W.mayDelete(t, n, !1);
				if (i) throw new W.ErrnoError(i);
				if (!t.node_ops.unlink) throw new W.ErrnoError(63);
				if (W.isMountpoint(r)) throw new W.ErrnoError(10);
				t.node_ops.unlink(t, n), W.destroyNode(r);
			},
			readlink(e) {
				var t = W.lookupPath(e).node;
				if (!t) throw new W.ErrnoError(44);
				if (!t.node_ops.readlink) throw new W.ErrnoError(28);
				return t.node_ops.readlink(t);
			},
			stat(e, t) {
				var n = W.lookupPath(e, { follow: !t }).node;
				return W.checkOpExists(n.node_ops.getattr, 63)(n);
			},
			fstat(e) {
				var t = W.getStreamChecked(e), n = t.node, r = t.stream_ops.getattr, i = r ? t : n;
				return r ??= n.node_ops.getattr, W.checkOpExists(r, 63), r(i);
			},
			lstat(e) {
				return W.stat(e, !0);
			},
			doChmod(e, t, n, r) {
				W.doSetAttr(e, t, {
					mode: n & 4095 | t.mode & -4096,
					ctime: Date.now(),
					dontFollow: r
				});
			},
			chmod(e, t, n) {
				var r = typeof e == "string" ? W.lookupPath(e, { follow: !n }).node : e;
				W.doChmod(null, r, t, n);
			},
			lchmod(e, t) {
				W.chmod(e, t, !0);
			},
			fchmod(e, t) {
				var n = W.getStreamChecked(e);
				W.doChmod(n, n.node, t, !1);
			},
			doChown(e, t, n) {
				W.doSetAttr(e, t, {
					timestamp: Date.now(),
					dontFollow: n
				});
			},
			chown(e, t, n, r) {
				var i = typeof e == "string" ? W.lookupPath(e, { follow: !r }).node : e;
				W.doChown(null, i, r);
			},
			lchown(e, t, n) {
				W.chown(e, t, n, !0);
			},
			fchown(e, t, n) {
				var r = W.getStreamChecked(e);
				W.doChown(r, r.node, !1);
			},
			doTruncate(e, t, n) {
				if (W.isDir(t.mode)) throw new W.ErrnoError(31);
				if (!W.isFile(t.mode)) throw new W.ErrnoError(28);
				var r = W.nodePermissions(t, "w");
				if (r) throw new W.ErrnoError(r);
				W.doSetAttr(e, t, {
					size: n,
					timestamp: Date.now()
				});
			},
			truncate(e, t) {
				if (t < 0) throw new W.ErrnoError(28);
				var n = typeof e == "string" ? W.lookupPath(e, { follow: !0 }).node : e;
				W.doTruncate(null, n, t);
			},
			ftruncate(e, t) {
				var n = W.getStreamChecked(e);
				if (t < 0 || !(n.flags & 2097155)) throw new W.ErrnoError(28);
				W.doTruncate(n, n.node, t);
			},
			utime(e, t, n) {
				var r = W.lookupPath(e, { follow: !0 }).node;
				W.checkOpExists(r.node_ops.setattr, 63)(r, {
					atime: t,
					mtime: n
				});
			},
			open(e, t, n = 438) {
				if (e === "") throw new W.ErrnoError(44);
				t = typeof t == "string" ? nt(t) : t, n = t & 64 ? n & 4095 | 32768 : 0;
				var i, a;
				if (typeof e == "object") i = e;
				else {
					a = e.endsWith("/");
					var o = W.lookupPath(e, {
						follow: !(t & 131072),
						noent_okay: !0
					});
					i = o.node, e = o.path;
				}
				var s = !1;
				if (t & 64) if (i) {
					if (t & 128) throw new W.ErrnoError(20);
				} else if (a) throw new W.ErrnoError(31);
				else i = W.mknod(e, n | 511, 0), s = !0;
				if (!i) throw new W.ErrnoError(44);
				if (W.isChrdev(i.mode) && (t &= -513), t & 65536 && !W.isDir(i.mode)) throw new W.ErrnoError(54);
				if (!s) {
					var c = W.mayOpen(i, t);
					if (c) throw new W.ErrnoError(c);
				}
				t & 512 && !s && W.truncate(i, 0), t &= -131713;
				var l = W.createStream({
					node: i,
					path: W.getPath(i),
					flags: t,
					seekable: !0,
					position: 0,
					stream_ops: i.stream_ops,
					ungotten: [],
					error: !1
				});
				return l.stream_ops.open && l.stream_ops.open(l), s && W.chmod(i, n & 511), r.logReadFiles && !(t & 1) && (e in W.readFiles || (W.readFiles[e] = 1)), l;
			},
			close(e) {
				if (W.isClosed(e)) throw new W.ErrnoError(8);
				e.getdents &&= null;
				try {
					e.stream_ops.close && e.stream_ops.close(e);
				} catch (e) {
					throw e;
				} finally {
					W.closeStream(e.fd);
				}
				e.fd = null;
			},
			isClosed(e) {
				return e.fd === null;
			},
			llseek(e, t, n) {
				if (W.isClosed(e)) throw new W.ErrnoError(8);
				if (!e.seekable || !e.stream_ops.llseek) throw new W.ErrnoError(70);
				if (n != 0 && n != 1 && n != 2) throw new W.ErrnoError(28);
				return e.position = e.stream_ops.llseek(e, t, n), e.ungotten = [], e.position;
			},
			read(e, t, n, r, i) {
				if (r < 0 || i < 0) throw new W.ErrnoError(28);
				if (W.isClosed(e) || (e.flags & 2097155) == 1) throw new W.ErrnoError(8);
				if (W.isDir(e.node.mode)) throw new W.ErrnoError(31);
				if (!e.stream_ops.read) throw new W.ErrnoError(28);
				var a = i !== void 0;
				if (!a) i = e.position;
				else if (!e.seekable) throw new W.ErrnoError(70);
				var o = e.stream_ops.read(e, t, n, r, i);
				return a || (e.position += o), o;
			},
			write(e, t, n, r, i, a) {
				if (r < 0 || i < 0) throw new W.ErrnoError(28);
				if (W.isClosed(e) || !(e.flags & 2097155)) throw new W.ErrnoError(8);
				if (W.isDir(e.node.mode)) throw new W.ErrnoError(31);
				if (!e.stream_ops.write) throw new W.ErrnoError(28);
				e.seekable && e.flags & 1024 && W.llseek(e, 0, 2);
				var o = i !== void 0;
				if (!o) i = e.position;
				else if (!e.seekable) throw new W.ErrnoError(70);
				var s = e.stream_ops.write(e, t, n, r, i, a);
				return o || (e.position += s), s;
			},
			mmap(e, t, n, r, i) {
				if (r & 2 && !(i & 2) && (e.flags & 2097155) != 2 || (e.flags & 2097155) == 1) throw new W.ErrnoError(2);
				if (!e.stream_ops.mmap) throw new W.ErrnoError(43);
				if (!t) throw new W.ErrnoError(28);
				return e.stream_ops.mmap(e, t, n, r, i);
			},
			msync(e, t, n, r, i) {
				return e.stream_ops.msync ? e.stream_ops.msync(e, t, n, r, i) : 0;
			},
			ioctl(e, t, n) {
				if (!e.stream_ops.ioctl) throw new W.ErrnoError(59);
				return e.stream_ops.ioctl(e, t, n);
			},
			readFile(e, t = {}) {
				if (t.flags = t.flags || 0, t.encoding = t.encoding || "binary", t.encoding !== "utf8" && t.encoding !== "binary") throw Error(`Invalid encoding type "${t.encoding}"`);
				var n, r = W.open(e, t.flags), i = W.stat(e).size, a = new Uint8Array(i);
				return W.read(r, a, 0, i, 0), t.encoding === "utf8" ? n = We(a) : t.encoding === "binary" && (n = a), W.close(r), n;
			},
			writeFile(e, t, n = {}) {
				n.flags = n.flags || 577;
				var r = W.open(e, n.flags, n.mode);
				if (typeof t == "string") {
					var i = new Uint8Array(Ke(t) + 1), a = B(t, i, 0, i.length);
					W.write(r, i, 0, a, void 0, n.canOwn);
				} else if (ArrayBuffer.isView(t)) W.write(r, t, 0, t.byteLength, void 0, n.canOwn);
				else throw Error("Unsupported data type");
				W.close(r);
			},
			cwd: () => W.currentPath,
			chdir(e) {
				var t = W.lookupPath(e, { follow: !0 });
				if (t.node === null) throw new W.ErrnoError(44);
				if (!W.isDir(t.node.mode)) throw new W.ErrnoError(54);
				var n = W.nodePermissions(t.node, "x");
				if (n) throw new W.ErrnoError(n);
				W.currentPath = t.path;
			},
			createDefaultDirectories() {
				W.mkdir("/tmp"), W.mkdir("/home"), W.mkdir("/home/web_user");
			},
			createDefaultDevices() {
				W.mkdir("/dev"), W.registerDevice(W.makedev(1, 3), {
					read: () => 0,
					write: (e, t, n, r, i) => r,
					llseek: () => 0
				}), W.mkdev("/dev/null", W.makedev(1, 3)), V.register(W.makedev(5, 0), V.default_tty_ops), V.register(W.makedev(6, 0), V.default_tty1_ops), W.mkdev("/dev/tty", W.makedev(5, 0)), W.mkdev("/dev/tty1", W.makedev(6, 0));
				var e = new Uint8Array(1024), t = 0, n = () => (t === 0 && (He(e), t = e.byteLength), e[--t]);
				W.createDevice("/dev", "random", n), W.createDevice("/dev", "urandom", n), W.mkdir("/dev/shm"), W.mkdir("/dev/shm/tmp");
			},
			createSpecialDirectories() {
				W.mkdir("/proc");
				var e = W.mkdir("/proc/self");
				W.mkdir("/proc/self/fd"), W.mount({ mount() {
					var t = W.createNode(e, "fd", 16895, 73);
					return t.stream_ops = { llseek: H.stream_ops.llseek }, t.node_ops = {
						lookup(e, t) {
							var n = +t, r = W.getStreamChecked(n), i = {
								parent: null,
								mount: { mountpoint: "fake" },
								node_ops: { readlink: () => r.path },
								id: n + 1
							};
							return i.parent = i, i;
						},
						readdir() {
							return Array.from(W.streams.entries()).filter(([e, t]) => t).map(([e, t]) => e.toString());
						}
					}, t;
				} }, {}, "/proc/self/fd");
			},
			createStandardStreams(e, t, n) {
				e ? W.createDevice("/dev", "stdin", e) : W.symlink("/dev/tty", "/dev/stdin"), t ? W.createDevice("/dev", "stdout", null, t) : W.symlink("/dev/tty", "/dev/stdout"), n ? W.createDevice("/dev", "stderr", null, n) : W.symlink("/dev/tty1", "/dev/stderr"), W.open("/dev/stdin", 0), W.open("/dev/stdout", 1), W.open("/dev/stderr", 1);
			},
			staticInit() {
				W.nameTable = Array(4096), W.mount(H, {}, "/"), W.createDefaultDirectories(), W.createDefaultDevices(), W.createSpecialDirectories(), W.filesystems = { MEMFS: H };
			},
			init(e, t, n) {
				W.initialized = !0, e ??= r.stdin, t ??= r.stdout, n ??= r.stderr, W.createStandardStreams(e, t, n);
			},
			quit() {
				W.initialized = !1;
				for (var e of W.streams) e && W.close(e);
			},
			findObject(e, t) {
				var n = W.analyzePath(e, t);
				return n.exists ? n.object : null;
			},
			analyzePath(e, t) {
				try {
					var n = W.lookupPath(e, { follow: !t });
					e = n.path;
				} catch {}
				var r = {
					isRoot: !1,
					exists: !1,
					error: 0,
					name: null,
					path: null,
					object: null,
					parentExists: !1,
					parentPath: null,
					parentObject: null
				};
				try {
					var n = W.lookupPath(e, { parent: !0 });
					r.parentExists = !0, r.parentPath = n.path, r.parentObject = n.node, r.name = R.basename(e), n = W.lookupPath(e, { follow: !t }), r.exists = !0, r.path = n.path, r.object = n.node, r.name = n.node.name, r.isRoot = n.path === "/";
				} catch (e) {
					r.error = e.errno;
				}
				return r;
			},
			createPath(e, t, n, r) {
				e = typeof e == "string" ? e : W.getPath(e);
				for (var i = t.split("/").reverse(); i.length;) {
					var a = i.pop();
					if (a) {
						var o = R.join2(e, a);
						try {
							W.mkdir(o);
						} catch (e) {
							if (e.errno != 20) throw e;
						}
						e = o;
					}
				}
				return o;
			},
			createFile(e, t, n, r, i) {
				var a = R.join2(typeof e == "string" ? e : W.getPath(e), t), o = rt(r, i);
				return W.create(a, o);
			},
			createDataFile(e, t, n, r, i, a) {
				var o = t;
				e && (e = typeof e == "string" ? e : W.getPath(e), o = t ? R.join2(e, t) : e);
				var s = rt(r, i), c = W.create(o, s);
				if (n) {
					if (typeof n == "string") {
						for (var l = Array(n.length), u = 0, d = n.length; u < d; ++u) l[u] = n.charCodeAt(u);
						n = l;
					}
					W.chmod(c, s | 146);
					var f = W.open(c, 577);
					W.write(f, n, 0, n.length, 0, a), W.close(f), W.chmod(c, s);
				}
			},
			createDevice(e, t, n, r) {
				var i = R.join2(typeof e == "string" ? e : W.getPath(e), t), a = rt(!!n, !!r);
				W.createDevice.major ??= 64;
				var o = W.makedev(W.createDevice.major++, 0);
				return W.registerDevice(o, {
					open(e) {
						e.seekable = !1;
					},
					close(e) {
						r?.buffer?.length && r(10);
					},
					read(e, t, r, i, a) {
						for (var o = 0, s = 0; s < i; s++) {
							var c;
							try {
								c = n();
							} catch {
								throw new W.ErrnoError(29);
							}
							if (c === void 0 && o === 0) throw new W.ErrnoError(6);
							if (c == null) break;
							o++, t[r + s] = c;
						}
						return o && (e.node.atime = Date.now()), o;
					},
					write(e, t, n, i, a) {
						for (var o = 0; o < i; o++) try {
							r(t[n + o]);
						} catch {
							throw new W.ErrnoError(29);
						}
						return i && (e.node.mtime = e.node.ctime = Date.now()), o;
					}
				}), W.mkdev(i, a, o);
			},
			forceLoadFile(e) {
				if (e.isDevice || e.isFolder || e.link || e.contents) return !0;
				if (typeof XMLHttpRequest < "u") throw Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
				try {
					e.contents = ee(e.url), e.usedBytes = e.contents.length;
				} catch {
					throw new W.ErrnoError(29);
				}
			},
			createLazyFile(e, t, n, r, i) {
				class a {
					lengthKnown = !1;
					chunks = [];
					get(e) {
						if (!(e > this.length - 1 || e < 0)) {
							var t = e % this.chunkSize, n = e / this.chunkSize | 0;
							return this.getter(n)[t];
						}
					}
					setDataGetter(e) {
						this.getter = e;
					}
					cacheLength() {
						var e = new XMLHttpRequest();
						if (e.open("HEAD", n, !1), e.send(null), !(e.status >= 200 && e.status < 300 || e.status === 304)) throw Error("Couldn't load " + n + ". Status: " + e.status);
						var t = Number(e.getResponseHeader("Content-length")), r, i = (r = e.getResponseHeader("Accept-Ranges")) && r === "bytes", a = (r = e.getResponseHeader("Content-Encoding")) && r === "gzip", o = 1024 * 1024;
						i || (o = t);
						var s = (e, r) => {
							if (e > r) throw Error("invalid range (" + e + ", " + r + ") or no bytes requested!");
							if (r > t - 1) throw Error("only " + t + " bytes available! programmer error!");
							var i = new XMLHttpRequest();
							if (i.open("GET", n, !1), t !== o && i.setRequestHeader("Range", "bytes=" + e + "-" + r), i.responseType = "arraybuffer", i.overrideMimeType && i.overrideMimeType("text/plain; charset=x-user-defined"), i.send(null), !(i.status >= 200 && i.status < 300 || i.status === 304)) throw Error("Couldn't load " + n + ". Status: " + i.status);
							return i.response === void 0 ? qe(i.responseText || "", !0) : new Uint8Array(i.response || []);
						}, c = this;
						c.setDataGetter((e) => {
							var n = e * o, r = (e + 1) * o - 1;
							if (r = Math.min(r, t - 1), c.chunks[e] === void 0 && (c.chunks[e] = s(n, r)), c.chunks[e] === void 0) throw Error("doXHR failed!");
							return c.chunks[e];
						}), (a || !t) && (o = t = 1, t = this.getter(0).length, o = t, m("LazyFiles on gzip forces download of the whole file when length is accessed")), this._length = t, this._chunkSize = o, this.lengthKnown = !0;
					}
					get length() {
						return this.lengthKnown || this.cacheLength(), this._length;
					}
					get chunkSize() {
						return this.lengthKnown || this.cacheLength(), this._chunkSize;
					}
				}
				if (typeof XMLHttpRequest < "u") {
					if (!c) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
					var o = {
						isDevice: !1,
						contents: new a()
					};
				} else var o = {
					isDevice: !1,
					url: n
				};
				var s = W.createFile(e, t, o, r, i);
				o.contents ? s.contents = o.contents : o.url && (s.contents = null, s.url = o.url), Object.defineProperties(s, { usedBytes: { get: function() {
					return this.contents.length;
				} } });
				var l = {};
				Object.keys(s.stream_ops).forEach((e) => {
					var t = s.stream_ops[e];
					l[e] = (...e) => (W.forceLoadFile(s), t(...e));
				});
				function u(e, t, n, r, i) {
					var a = e.node.contents;
					if (i >= a.length) return 0;
					var o = Math.min(a.length - i, r);
					if (a.slice) for (var s = 0; s < o; s++) t[n + s] = a[i + s];
					else for (var s = 0; s < o; s++) t[n + s] = a.get(i + s);
					return o;
				}
				return l.read = (e, t, n, r, i) => (W.forceLoadFile(s), u(e, t, n, r, i)), l.mmap = (e, t, n, r, i) => {
					W.forceLoadFile(s);
					var a = Ze(t);
					if (!a) throw new W.ErrnoError(48);
					return u(e, _, a, t, n), {
						ptr: a,
						allocated: !0
					};
				}, s.stream_ops = l, s;
			}
		}, it = (e, t) => (e >>>= 0, e ? We(v, e, t) : ""), G = {
			DEFAULT_POLLMASK: 5,
			calculateAt(e, t, n) {
				if (R.isAbs(t)) return t;
				var r = e === -100 ? W.cwd() : G.getStreamFromFD(e).path;
				if (t.length == 0) {
					if (!n) throw new W.ErrnoError(44);
					return r;
				}
				return r + "/" + t;
			},
			writeStat(e, t) {
				b[e >>> 2 >>> 0] = t.dev, b[e + 4 >>> 2 >>> 0] = t.mode, x[e + 8 >>> 2 >>> 0] = t.nlink, b[e + 12 >>> 2 >>> 0] = t.uid, b[e + 16 >>> 2 >>> 0] = t.gid, b[e + 20 >>> 2 >>> 0] = t.rdev, S[e + 24 >>> 3] = BigInt(t.size), b[e + 32 >>> 2 >>> 0] = 4096, b[e + 36 >>> 2 >>> 0] = t.blocks;
				var n = t.atime.getTime(), r = t.mtime.getTime(), i = t.ctime.getTime();
				return S[e + 40 >>> 3] = BigInt(Math.floor(n / 1e3)), x[e + 48 >>> 2 >>> 0] = n % 1e3 * 1e3 * 1e3, S[e + 56 >>> 3] = BigInt(Math.floor(r / 1e3)), x[e + 64 >>> 2 >>> 0] = r % 1e3 * 1e3 * 1e3, S[e + 72 >>> 3] = BigInt(Math.floor(i / 1e3)), x[e + 80 >>> 2 >>> 0] = i % 1e3 * 1e3 * 1e3, S[e + 88 >>> 3] = BigInt(t.ino), 0;
			},
			writeStatFs(e, t) {
				b[e + 4 >>> 2 >>> 0] = t.bsize, b[e + 40 >>> 2 >>> 0] = t.bsize, b[e + 8 >>> 2 >>> 0] = t.blocks, b[e + 12 >>> 2 >>> 0] = t.bfree, b[e + 16 >>> 2 >>> 0] = t.bavail, b[e + 20 >>> 2 >>> 0] = t.files, b[e + 24 >>> 2 >>> 0] = t.ffree, b[e + 28 >>> 2 >>> 0] = t.fsid, b[e + 44 >>> 2 >>> 0] = t.flags, b[e + 36 >>> 2 >>> 0] = t.namelen;
			},
			doMsync(e, t, n, r, i) {
				if (!W.isFile(t.node.mode)) throw new W.ErrnoError(43);
				if (r & 2) return 0;
				var a = v.slice(e, e + n);
				W.msync(t, a, i, n, r);
			},
			getStreamFromFD(e) {
				return W.getStreamChecked(e);
			},
			varargs: void 0,
			getStr(e) {
				return it(e);
			}
		};
		function at(e, t) {
			e >>>= 0;
			try {
				return e = G.getStr(e), W.chmod(e, t), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function ot(e) {
			try {
				var t = G.getStreamFromFD(e);
				return W.dupStream(t).fd;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function st(e, t, n, r) {
			t >>>= 0;
			try {
				if (t = G.getStr(t), t = G.calculateAt(e, t), n & -8) return -28;
				var i = W.lookupPath(t, { follow: !0 }).node;
				if (!i) return -44;
				var a = "";
				return n & 4 && (a += "r"), n & 2 && (a += "w"), n & 1 && (a += "x"), a && W.nodePermissions(i, a) ? -2 : 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function ct(e, t, n, r) {
			n = P(n), r = P(r);
			try {
				if (isNaN(n)) return 61;
				if (t != 0) return -138;
				if (n < 0 || r < 0) return -28;
				var i = W.fstat(e).size, a = n + r;
				return a > i && W.ftruncate(e, a), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function lt(e, t) {
			try {
				return W.fchmod(e, t), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		var ut = () => {
			var e = b[G.varargs >>> 2 >>> 0];
			return G.varargs += 4, e;
		}, dt = ut;
		function ft(e, t, n) {
			n >>>= 0, G.varargs = n;
			try {
				var r = G.getStreamFromFD(e);
				switch (t) {
					case 0:
						var i = ut();
						if (i < 0) return -28;
						for (; W.streams[i];) i++;
						return W.dupStream(r, i).fd;
					case 1:
					case 2: return 0;
					case 3: return r.flags;
					case 4:
						var i = ut();
						return r.flags |= i, 0;
					case 12:
						var i = dt(), a = 0;
						return y[i + a >>> 1 >>> 0] = 2, 0;
					case 13:
					case 14: return 0;
				}
				return -28;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function pt(e, t) {
			t >>>= 0;
			try {
				return G.writeStat(t, W.fstat(e));
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		var K = (e, t, n) => B(e, v, t, n);
		function mt(e, t) {
			e >>>= 0, t >>>= 0;
			try {
				if (t === 0) return -28;
				var n = W.cwd(), r = Ke(n) + 1;
				return t < r ? -68 : (K(n, e, t), r);
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function ht(e, t, n) {
			t >>>= 0, n >>>= 0;
			try {
				var r = G.getStreamFromFD(e);
				r.getdents ||= W.readdir(r.path);
				for (var i = 280, a = 0, o = W.llseek(r, 0, 1), s = Math.floor(o / i), c = Math.min(r.getdents.length, s + Math.floor(n / i)), l = s; l < c; l++) {
					var u, d, f = r.getdents[l];
					if (f === ".") u = r.node.id, d = 4;
					else if (f === "..") u = W.lookupPath(r.path, { parent: !0 }).node.id, d = 4;
					else {
						var p;
						try {
							p = W.lookupNode(r.node, f);
						} catch (e) {
							if (e?.errno === 28) continue;
							throw e;
						}
						u = p.id, d = W.isChrdev(p.mode) ? 2 : W.isDir(p.mode) ? 4 : W.isLink(p.mode) ? 10 : 8;
					}
					S[t + a >>> 3] = BigInt(u), S[t + a + 8 >>> 3] = BigInt((l + 1) * i), y[t + a + 16 >>> 1 >>> 0] = 280, _[t + a + 18 >>> 0] = d, K(f, t + a + 19, 256), a += i;
				}
				return W.llseek(r, l * i, 0), a;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function gt(e, t, n) {
			n >>>= 0, G.varargs = n;
			try {
				var r = G.getStreamFromFD(e);
				switch (t) {
					case 21509: return r.tty ? 0 : -59;
					case 21505:
						if (!r.tty) return -59;
						if (r.tty.ops.ioctl_tcgets) {
							var i = r.tty.ops.ioctl_tcgets(r), a = dt();
							b[a >>> 2 >>> 0] = i.c_iflag || 0, b[a + 4 >>> 2 >>> 0] = i.c_oflag || 0, b[a + 8 >>> 2 >>> 0] = i.c_cflag || 0, b[a + 12 >>> 2 >>> 0] = i.c_lflag || 0;
							for (var o = 0; o < 32; o++) _[a + o + 17 >>> 0] = i.c_cc[o] || 0;
							return 0;
						}
						return 0;
					case 21510:
					case 21511:
					case 21512: return r.tty ? 0 : -59;
					case 21506:
					case 21507:
					case 21508:
						if (!r.tty) return -59;
						if (r.tty.ops.ioctl_tcsets) {
							for (var a = dt(), s = b[a >>> 2 >>> 0], c = b[a + 4 >>> 2 >>> 0], l = b[a + 8 >>> 2 >>> 0], u = b[a + 12 >>> 2 >>> 0], d = [], o = 0; o < 32; o++) d.push(_[a + o + 17 >>> 0]);
							return r.tty.ops.ioctl_tcsets(r.tty, t, {
								c_iflag: s,
								c_oflag: c,
								c_cflag: l,
								c_lflag: u,
								c_cc: d
							});
						}
						return 0;
					case 21519:
						if (!r.tty) return -59;
						var a = dt();
						return b[a >>> 2 >>> 0] = 0, 0;
					case 21520: return r.tty ? -28 : -59;
					case 21531:
						var a = dt();
						return W.ioctl(r, t, a);
					case 21523:
						if (!r.tty) return -59;
						if (r.tty.ops.ioctl_tiocgwinsz) {
							var f = r.tty.ops.ioctl_tiocgwinsz(r.tty), a = dt();
							y[a >>> 1 >>> 0] = f[0], y[a + 2 >>> 1 >>> 0] = f[1];
						}
						return 0;
					case 21524: return r.tty ? 0 : -59;
					case 21515: return r.tty ? 0 : -59;
					default: return -28;
				}
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function _t(e, t) {
			e >>>= 0, t >>>= 0;
			try {
				return e = G.getStr(e), G.writeStat(t, W.lstat(e));
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function vt(e, t, n, r) {
			t >>>= 0, n >>>= 0;
			try {
				t = G.getStr(t);
				var i = r & 256, a = r & 4096;
				return r &= -6401, t = G.calculateAt(e, t, a), G.writeStat(n, i ? W.lstat(t) : W.stat(t));
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function yt(e, t, n, r) {
			t >>>= 0, r >>>= 0, G.varargs = r;
			try {
				t = G.getStr(t), t = G.calculateAt(e, t);
				var i = r ? ut() : 0;
				return W.open(t, n, i).fd;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function bt(e, t, n, r) {
			t >>>= 0, n >>>= 0, r >>>= 0;
			try {
				if (t = G.getStr(t), t = G.calculateAt(e, t), r <= 0) return -28;
				var i = W.readlink(t), a = Math.min(r, Ke(i)), o = _[n + a >>> 0];
				return K(i, n, r + 1), _[n + a >>> 0] = o, a;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function xt(e, t, n, r) {
			t >>>= 0, r >>>= 0;
			try {
				return t = G.getStr(t), r = G.getStr(r), t = G.calculateAt(e, t), r = G.calculateAt(n, r), W.rename(t, r), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function St(e) {
			e >>>= 0;
			try {
				return e = G.getStr(e), W.rmdir(e), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function Ct(e, t) {
			e >>>= 0, t >>>= 0;
			try {
				return e = G.getStr(e), G.writeStat(t, W.stat(e));
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function wt(e, t, n) {
			e >>>= 0, n >>>= 0;
			try {
				return e = G.getStr(e), n = G.getStr(n), n = G.calculateAt(t, n), W.symlink(e, n), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function Tt(e, t, n) {
			t >>>= 0;
			try {
				return t = G.getStr(t), t = G.calculateAt(e, t), n === 0 ? W.unlink(t) : n === 512 ? W.rmdir(t) : de("Invalid flags passed to unlinkat"), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		var Et = () => de(""), Dt = {}, Ot = (e) => {
			for (; e.length;) {
				var t = e.pop();
				e.pop()(t);
			}
		};
		function kt(e) {
			return this.fromWireType(x[e >>> 2 >>> 0]);
		}
		var At = {}, jt = {}, Mt = {}, Nt = r.InternalError = class extends Error {
			constructor(e) {
				super(e), this.name = "InternalError";
			}
		}, Pt = (e) => {
			throw new Nt(e);
		}, Ft = (e, t, n) => {
			e.forEach((e) => Mt[e] = t);
			function r(t) {
				var r = n(t);
				r.length !== e.length && Pt("Mismatched type converter count");
				for (var i = 0; i < e.length; ++i) Y(e[i], r[i]);
			}
			var i = Array(t.length), a = [], o = 0;
			t.forEach((e, t) => {
				jt.hasOwnProperty(e) ? i[t] = jt[e] : (a.push(e), At.hasOwnProperty(e) || (At[e] = []), At[e].push(() => {
					i[t] = jt[e], ++o, o === a.length && r(i);
				}));
			}), a.length === 0 && r(i);
		}, It = function(e) {
			e >>>= 0;
			var t = Dt[e];
			delete Dt[e];
			var n = t.rawConstructor, r = t.rawDestructor, i = t.fields, a = i.map((e) => e.getterReturnType).concat(i.map((e) => e.setterArgumentType));
			Ft([e], a, (e) => {
				var a = {};
				return i.forEach((t, n) => {
					var r = t.fieldName, o = e[n], s = e[n].optional, c = t.getter, l = t.getterContext, u = e[n + i.length], d = t.setter, f = t.setterContext;
					a[r] = {
						read: (e) => o.fromWireType(c(l, e)),
						write: (e, t) => {
							var n = [];
							d(f, e, u.toWireType(n, t)), Ot(n);
						},
						optional: s
					};
				}), [{
					name: t.name,
					fromWireType: (e) => {
						var t = {};
						for (var n in a) t[n] = a[n].read(e);
						return r(e), t;
					},
					toWireType: (e, t) => {
						for (var i in a) if (!(i in t) && !a[i].optional) throw TypeError(`Missing field: "${i}"`);
						var o = n();
						for (i in a) a[i].write(o, t[i]);
						return e !== null && e.push(r, o), o;
					},
					argPackAdvance: X,
					readValueFromPointer: kt,
					destructorFunction: r
				}];
			});
		}, Lt = (e) => {
			if (e === null) return "null";
			var t = typeof e;
			return t === "object" || t === "array" || t === "function" ? e.toString() : "" + e;
		}, Rt = () => {
			for (var e = Array(256), t = 0; t < 256; ++t) e[t] = String.fromCharCode(t);
			zt = e;
		}, zt, q = (e) => {
			for (var t = "", n = e; v[n >>> 0];) t += zt[v[n++ >>> 0]];
			return t;
		}, Bt = r.BindingError = class extends Error {
			constructor(e) {
				super(e), this.name = "BindingError";
			}
		}, J = (e) => {
			throw new Bt(e);
		};
		function Vt(e, t, n = {}) {
			var r = t.name;
			if (e || J(`type "${r}" must have a positive integer typeid pointer`), jt.hasOwnProperty(e)) {
				if (n.ignoreDuplicateRegistrations) return;
				J(`Cannot register type '${r}' twice`);
			}
			if (jt[e] = t, delete Mt[e], At.hasOwnProperty(e)) {
				var i = At[e];
				delete At[e], i.forEach((e) => e());
			}
		}
		function Y(e, t, n = {}) {
			return Vt(e, t, n);
		}
		var Ht = (e, t, n) => {
			switch (t) {
				case 1: return n ? (e) => _[e >>> 0] : (e) => v[e >>> 0];
				case 2: return n ? (e) => y[e >>> 1 >>> 0] : (e) => re[e >>> 1 >>> 0];
				case 4: return n ? (e) => b[e >>> 2 >>> 0] : (e) => x[e >>> 2 >>> 0];
				case 8: return n ? (e) => S[e >>> 3] : (e) => ae[e >>> 3];
				default: throw TypeError(`invalid integer width (${t}): ${e}`);
			}
		};
		function Ut(e, t, n, r, i) {
			e >>>= 0, t >>>= 0, n >>>= 0, t = q(t);
			var a = t.indexOf("u") != -1;
			a && (i = (1n << 64n) - 1n), Y(e, {
				name: t,
				fromWireType: (e) => e,
				toWireType: function(e, t) {
					if (typeof t != "bigint" && typeof t != "number") throw TypeError(`Cannot convert "${Lt(t)}" to ${this.name}`);
					return typeof t == "number" && (t = BigInt(t)), t;
				},
				argPackAdvance: X,
				readValueFromPointer: Ht(t, n, !a),
				destructorFunction: null
			});
		}
		var X = 8;
		function Wt(e, t, n, r) {
			e >>>= 0, t >>>= 0, t = q(t), Y(e, {
				name: t,
				fromWireType: function(e) {
					return !!e;
				},
				toWireType: function(e, t) {
					return t ? n : r;
				},
				argPackAdvance: X,
				readValueFromPointer: function(e) {
					return this.fromWireType(v[e >>> 0]);
				},
				destructorFunction: null
			});
		}
		var Gt = (e) => ({
			count: e.count,
			deleteScheduled: e.deleteScheduled,
			preservePointerOnDelete: e.preservePointerOnDelete,
			ptr: e.ptr,
			ptrType: e.ptrType,
			smartPtr: e.smartPtr,
			smartPtrType: e.smartPtrType
		}), Kt = (e) => {
			function t(e) {
				return e.$$.ptrType.registeredClass.name;
			}
			J(t(e) + " instance already deleted");
		}, qt = !1, Jt = (e) => {}, Yt = (e) => {
			e.smartPtr ? e.smartPtrType.rawDestructor(e.smartPtr) : e.ptrType.registeredClass.rawDestructor(e.ptr);
		}, Xt = (e) => {
			--e.count.value, e.count.value === 0 && Yt(e);
		}, Zt = (e) => typeof FinalizationRegistry > "u" ? (Zt = (e) => e, e) : (qt = new FinalizationRegistry((e) => {
			Xt(e.$$);
		}), Zt = (e) => {
			var t = e.$$;
			if (t.smartPtr) {
				var n = { $$: t };
				qt.register(e, n, e);
			}
			return e;
		}, Jt = (e) => qt.unregister(e), Zt(e)), Qt = [], $t = () => {
			for (; Qt.length;) {
				var e = Qt.pop();
				e.$$.deleteScheduled = !1, e.delete();
			}
		}, en, tn = () => {
			let e = nn.prototype;
			Object.assign(e, {
				isAliasOf(e) {
					if (!(this instanceof nn) || !(e instanceof nn)) return !1;
					var t = this.$$.ptrType.registeredClass, n = this.$$.ptr;
					e.$$ = e.$$;
					for (var r = e.$$.ptrType.registeredClass, i = e.$$.ptr; t.baseClass;) n = t.upcast(n), t = t.baseClass;
					for (; r.baseClass;) i = r.upcast(i), r = r.baseClass;
					return t === r && n === i;
				},
				clone() {
					if (this.$$.ptr || Kt(this), this.$$.preservePointerOnDelete) return this.$$.count.value += 1, this;
					var e = Zt(Object.create(Object.getPrototypeOf(this), { $$: { value: Gt(this.$$) } }));
					return e.$$.count.value += 1, e.$$.deleteScheduled = !1, e;
				},
				delete() {
					this.$$.ptr || Kt(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && J("Object already scheduled for deletion"), Jt(this), Xt(this.$$), this.$$.preservePointerOnDelete || (this.$$.smartPtr = void 0, this.$$.ptr = void 0);
				},
				isDeleted() {
					return !this.$$.ptr;
				},
				deleteLater() {
					return this.$$.ptr || Kt(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && J("Object already scheduled for deletion"), Qt.push(this), Qt.length === 1 && en && en($t), this.$$.deleteScheduled = !0, this;
				}
			});
			let t = Symbol.dispose;
			t && (e[t] = e.delete);
		};
		function nn() {}
		var rn = (e, t) => Object.defineProperty(t, "name", { value: e }), an = {}, on = (e, t, n) => {
			if (e[t].overloadTable === void 0) {
				var r = e[t];
				e[t] = function(...r) {
					return e[t].overloadTable.hasOwnProperty(r.length) || J(`Function '${n}' called with an invalid number of arguments (${r.length}) - expects one of (${e[t].overloadTable})!`), e[t].overloadTable[r.length].apply(this, r);
				}, e[t].overloadTable = [], e[t].overloadTable[r.argCount] = r;
			}
		}, sn = (e, t, n) => {
			r.hasOwnProperty(e) ? ((n === void 0 || r[e].overloadTable !== void 0 && r[e].overloadTable[n] !== void 0) && J(`Cannot register public name '${e}' twice`), on(r, e, e), r[e].overloadTable.hasOwnProperty(n) && J(`Cannot register multiple overloads of a function with the same number of arguments (${n})!`), r[e].overloadTable[n] = t) : (r[e] = t, r[e].argCount = n);
		}, cn = 48, ln = 57, un = (e) => {
			e = e.replace(/[^a-zA-Z0-9_]/g, "$");
			var t = e.charCodeAt(0);
			return t >= cn && t <= ln ? `_${e}` : e;
		};
		function dn(e, t, n, r, i, a, o, s) {
			this.name = e, this.constructor = t, this.instancePrototype = n, this.rawDestructor = r, this.baseClass = i, this.getActualType = a, this.upcast = o, this.downcast = s, this.pureVirtualFunctions = [];
		}
		var fn = (e, t, n) => {
			for (; t !== n;) t.upcast || J(`Expected null or instance of ${n.name}, got an instance of ${t.name}`), e = t.upcast(e), t = t.baseClass;
			return e;
		};
		function pn(e, t) {
			if (t === null) return this.isReference && J(`null is not a valid ${this.name}`), 0;
			t.$$ || J(`Cannot pass "${Lt(t)}" as a ${this.name}`), t.$$.ptr || J(`Cannot pass deleted object as a pointer of type ${this.name}`);
			var n = t.$$.ptrType.registeredClass;
			return fn(t.$$.ptr, n, this.registeredClass);
		}
		function mn(e, t) {
			var n;
			if (t === null) return this.isReference && J(`null is not a valid ${this.name}`), this.isSmartPointer ? (n = this.rawConstructor(), e !== null && e.push(this.rawDestructor, n), n) : 0;
			(!t || !t.$$) && J(`Cannot pass "${Lt(t)}" as a ${this.name}`), t.$$.ptr || J(`Cannot pass deleted object as a pointer of type ${this.name}`), !this.isConst && t.$$.ptrType.isConst && J(`Cannot convert argument of type ${t.$$.smartPtrType ? t.$$.smartPtrType.name : t.$$.ptrType.name} to parameter type ${this.name}`);
			var r = t.$$.ptrType.registeredClass;
			if (n = fn(t.$$.ptr, r, this.registeredClass), this.isSmartPointer) switch (t.$$.smartPtr === void 0 && J("Passing raw pointer to smart pointer is illegal"), this.sharingPolicy) {
				case 0:
					t.$$.smartPtrType === this ? n = t.$$.smartPtr : J(`Cannot convert argument of type ${t.$$.smartPtrType ? t.$$.smartPtrType.name : t.$$.ptrType.name} to parameter type ${this.name}`);
					break;
				case 1:
					n = t.$$.smartPtr;
					break;
				case 2:
					if (t.$$.smartPtrType === this) n = t.$$.smartPtr;
					else {
						var i = t.clone();
						n = this.rawShare(n, Z.toHandle(() => i.delete())), e !== null && e.push(this.rawDestructor, n);
					}
					break;
				default: J("Unsupporting sharing policy");
			}
			return n;
		}
		function hn(e, t) {
			if (t === null) return this.isReference && J(`null is not a valid ${this.name}`), 0;
			t.$$ || J(`Cannot pass "${Lt(t)}" as a ${this.name}`), t.$$.ptr || J(`Cannot pass deleted object as a pointer of type ${this.name}`), t.$$.ptrType.isConst && J(`Cannot convert argument of type ${t.$$.ptrType.name} to parameter type ${this.name}`);
			var n = t.$$.ptrType.registeredClass;
			return fn(t.$$.ptr, n, this.registeredClass);
		}
		var gn = (e, t, n) => {
			if (t === n) return e;
			if (n.baseClass === void 0) return null;
			var r = gn(e, t, n.baseClass);
			return r === null ? null : n.downcast(r);
		}, _n = {}, vn = (e, t) => {
			for (t === void 0 && J("ptr should not be undefined"); e.baseClass;) t = e.upcast(t), e = e.baseClass;
			return t;
		}, yn = (e, t) => (t = vn(e, t), _n[t]), bn = (e, t) => ((!t.ptrType || !t.ptr) && Pt("makeClassHandle requires ptr and ptrType"), !!t.smartPtrType != !!t.smartPtr && Pt("Both smartPtrType and smartPtr must be specified"), t.count = { value: 1 }, Zt(Object.create(e, { $$: {
			value: t,
			writable: !0
		} })));
		function xn(e) {
			var t = this.getPointee(e);
			if (!t) return this.destructor(e), null;
			var n = yn(this.registeredClass, t);
			if (n !== void 0) {
				if (n.$$.count.value === 0) return n.$$.ptr = t, n.$$.smartPtr = e, n.clone();
				var r = n.clone();
				return this.destructor(e), r;
			}
			function i() {
				return this.isSmartPointer ? bn(this.registeredClass.instancePrototype, {
					ptrType: this.pointeeType,
					ptr: t,
					smartPtrType: this,
					smartPtr: e
				}) : bn(this.registeredClass.instancePrototype, {
					ptrType: this,
					ptr: e
				});
			}
			var a = an[this.registeredClass.getActualType(t)];
			if (!a) return i.call(this);
			var o = this.isConst ? a.constPointerType : a.pointerType, s = gn(t, this.registeredClass, o.registeredClass);
			return s === null ? i.call(this) : this.isSmartPointer ? bn(o.registeredClass.instancePrototype, {
				ptrType: o,
				ptr: s,
				smartPtrType: this,
				smartPtr: e
			}) : bn(o.registeredClass.instancePrototype, {
				ptrType: o,
				ptr: s
			});
		}
		var Sn = () => {
			Object.assign(Cn.prototype, {
				getPointee(e) {
					return this.rawGetPointee && (e = this.rawGetPointee(e)), e;
				},
				destructor(e) {
					this.rawDestructor?.(e);
				},
				argPackAdvance: X,
				readValueFromPointer: kt,
				fromWireType: xn
			});
		};
		function Cn(e, t, n, r, i, a, o, s, c, l, u) {
			this.name = e, this.registeredClass = t, this.isReference = n, this.isConst = r, this.isSmartPointer = i, this.pointeeType = a, this.sharingPolicy = o, this.rawGetPointee = s, this.rawConstructor = c, this.rawShare = l, this.rawDestructor = u, !i && t.baseClass === void 0 ? r ? (this.toWireType = pn, this.destructorFunction = null) : (this.toWireType = hn, this.destructorFunction = null) : this.toWireType = mn;
		}
		var wn = (e, t, n) => {
			r.hasOwnProperty(e) || Pt("Replacing nonexistent public symbol"), r[e].overloadTable !== void 0 && n !== void 0 ? r[e].overloadTable[n] = t : (r[e] = t, r[e].argCount = n);
		}, Tn = (e, t, n = [], r = !1) => {
			var i = F(t)(...n);
			return e[0] == "p" ? i >>> 0 : i;
		}, En = (e, t, n = !1) => (...r) => Tn(e, t, r, n), Dn = (e, t, n = !1) => {
			e = q(e);
			function r() {
				return e.includes("p") ? En(e, t, n) : F(t);
			}
			var i = r();
			return typeof i != "function" && J(`unknown function pointer with signature ${e}: ${t}`), i;
		};
		class On extends Error {}
		var kn = (e) => {
			var t = ki(e), n = q(t);
			return ji(t), n;
		}, An = (e, t) => {
			var n = [], r = {};
			function i(e) {
				if (!r[e] && !jt[e]) {
					if (Mt[e]) {
						Mt[e].forEach(i);
						return;
					}
					n.push(e), r[e] = !0;
				}
			}
			throw t.forEach(i), new On(`${e}: ` + n.map(kn).join([", "]));
		};
		function jn(e, t, n, r, i, a, o, s, c, l, u, d, f) {
			e >>>= 0, t >>>= 0, n >>>= 0, r >>>= 0, i >>>= 0, a >>>= 0, o >>>= 0, s >>>= 0, c >>>= 0, l >>>= 0, u >>>= 0, d >>>= 0, f >>>= 0, u = q(u), a = Dn(i, a), s &&= Dn(o, s), l &&= Dn(c, l), f = Dn(d, f);
			var p = un(u);
			sn(p, function() {
				An(`Cannot construct ${u} due to unbound types`, [r]);
			}), Ft([
				e,
				t,
				n
			], r ? [r] : [], (t) => {
				t = t[0];
				var n, i;
				r ? (n = t.registeredClass, i = n.instancePrototype) : i = nn.prototype;
				var o = rn(u, function(...e) {
					if (Object.getPrototypeOf(this) !== c) throw new Bt(`Use 'new' to construct ${u}`);
					if (d.constructor_body === void 0) throw new Bt(`${u} has no accessible constructor`);
					var t = d.constructor_body[e.length];
					if (t === void 0) throw new Bt(`Tried to invoke ctor of ${u} with invalid number of parameters (${e.length}) - expected (${Object.keys(d.constructor_body).toString()}) parameters instead!`);
					return t.apply(this, e);
				}), c = Object.create(i, { constructor: { value: o } });
				o.prototype = c;
				var d = new dn(u, o, c, f, n, a, s, l);
				d.baseClass && (d.baseClass.__derivedClasses ??= [], d.baseClass.__derivedClasses.push(d));
				var ee = new Cn(u, d, !0, !1, !1), m = new Cn(u + "*", d, !1, !1, !1), h = new Cn(u + " const*", d, !1, !0, !1);
				return an[e] = {
					pointerType: m,
					constPointerType: h
				}, wn(p, o), [
					ee,
					m,
					h
				];
			});
		}
		var Mn = [], Nn = [];
		function Pn(e) {
			e >>>= 0, e > 9 && --Nn[e + 1] === 0 && (Nn[e] = void 0, Mn.push(e));
		}
		var Fn = () => Nn.length / 2 - 5 - Mn.length, In = () => {
			Nn.push(0, 1, void 0, 1, null, 1, !0, 1, !1, 1), r.count_emval_handles = Fn;
		}, Z = {
			toValue: (e) => (e || J(`Cannot use deleted val. handle = ${e}`), Nn[e]),
			toHandle: (e) => {
				switch (e) {
					case void 0: return 2;
					case null: return 4;
					case !0: return 6;
					case !1: return 8;
					default: {
						let t = Mn.pop() || Nn.length;
						return Nn[t] = e, Nn[t + 1] = 1, t;
					}
				}
			}
		}, Ln = {
			name: "emscripten::val",
			fromWireType: (e) => {
				var t = Z.toValue(e);
				return Pn(e), t;
			},
			toWireType: (e, t) => Z.toHandle(t),
			argPackAdvance: X,
			readValueFromPointer: kt,
			destructorFunction: null
		};
		function Rn(e) {
			return e >>>= 0, Y(e, Ln);
		}
		var zn = (e, t, n) => {
			switch (t) {
				case 1: return n ? function(e) {
					return this.fromWireType(_[e >>> 0]);
				} : function(e) {
					return this.fromWireType(v[e >>> 0]);
				};
				case 2: return n ? function(e) {
					return this.fromWireType(y[e >>> 1 >>> 0]);
				} : function(e) {
					return this.fromWireType(re[e >>> 1 >>> 0]);
				};
				case 4: return n ? function(e) {
					return this.fromWireType(b[e >>> 2 >>> 0]);
				} : function(e) {
					return this.fromWireType(x[e >>> 2 >>> 0]);
				};
				default: throw TypeError(`invalid integer width (${t}): ${e}`);
			}
		};
		function Bn(e, t, n, r) {
			e >>>= 0, t >>>= 0, n >>>= 0, t = q(t);
			function i() {}
			i.values = {}, Y(e, {
				name: t,
				constructor: i,
				fromWireType: function(e) {
					return this.constructor.values[e];
				},
				toWireType: (e, t) => t.value,
				argPackAdvance: X,
				readValueFromPointer: zn(t, n, r),
				destructorFunction: null
			}), sn(t, i);
		}
		var Vn = (e, t) => {
			var n = jt[e];
			return n === void 0 && J(`${t} has unknown type ${kn(e)}`), n;
		};
		function Hn(e, t, n) {
			e >>>= 0, t >>>= 0;
			var r = Vn(e, "enum");
			t = q(t);
			var i = r.constructor, a = Object.create(r.constructor.prototype, {
				value: { value: n },
				constructor: { value: rn(`${r.name}_${t}`, function() {}) }
			});
			i.values[n] = a, i[t] = a;
		}
		var Un = (e, t) => {
			switch (t) {
				case 4: return function(e) {
					return this.fromWireType(ie[e >>> 2 >>> 0]);
				};
				case 8: return function(e) {
					return this.fromWireType(oe[e >>> 3 >>> 0]);
				};
				default: throw TypeError(`invalid float width (${t}): ${e}`);
			}
		}, Wn = function(e, t, n) {
			e >>>= 0, t >>>= 0, n >>>= 0, t = q(t), Y(e, {
				name: t,
				fromWireType: (e) => e,
				toWireType: (e, t) => t,
				argPackAdvance: X,
				readValueFromPointer: Un(t, n),
				destructorFunction: null
			});
		};
		function Gn(e) {
			for (var t = 1; t < e.length; ++t) if (e[t] !== null && e[t].destructorFunction === void 0) return !0;
			return !1;
		}
		var Kn = {
			ftf: function(e, t, n, r, i, a, o) {
				return function() {
					var e = n(r);
					return a.fromWireType(e);
				};
			},
			ftft: function(e, t, n, r, i, a, o, s, c) {
				return function(e) {
					var t = s.toWireType(null, e), i = n(r, t);
					return c(t), a.fromWireType(i);
				};
			},
			ftfn: function(e, t, n, r, i, a, o, s) {
				return function(e) {
					var t = n(r, s.toWireType(null, e));
					return a.fromWireType(t);
				};
			},
			ftfnn: function(e, t, n, r, i, a, o, s, c) {
				return function(e, t) {
					var i = n(r, s.toWireType(null, e), c.toWireType(null, t));
					return a.fromWireType(i);
				};
			},
			fffn: function(e, t, n, r, i, a, o, s) {
				return function(e) {
					n(r, s.toWireType(null, e));
				};
			},
			ftfnnn: function(e, t, n, r, i, a, o, s, c, l) {
				return function(e, t, i) {
					var o = n(r, s.toWireType(null, e), c.toWireType(null, t), l.toWireType(null, i));
					return a.fromWireType(o);
				};
			},
			ftfnt: function(e, t, n, r, i, a, o, s, c, l) {
				return function(e, t) {
					var i = s.toWireType(null, e), o = c.toWireType(null, t), u = n(r, i, o);
					return l(o), a.fromWireType(u);
				};
			}
		};
		function qn(e, t, n, r) {
			let i = [
				t ? "t" : "f",
				n ? "t" : "f",
				r ? "t" : "f"
			];
			for (let n = t ? 1 : 2; n < e.length; ++n) {
				let t = e[n], r = "";
				r = t.destructorFunction === void 0 ? "u" : t.destructorFunction === null ? "n" : "t", i.push(r);
			}
			return i.join("");
		}
		function Jn(e, t, n, r, i, a) {
			var o = t.length;
			o < 2 && J("argTypes array size mismatch! Must at least get return value and 'this' types!");
			for (var s = t[1] !== null && n !== null, c = Gn(t), l = t[0].name !== "void", u = [
				e,
				J,
				r,
				i,
				Ot,
				t[0],
				t[1]
			], d = 0; d < o - 2; ++d) u.push(t[d + 2]);
			if (!c) for (var d = s ? 1 : 2; d < t.length; ++d) t[d].destructorFunction !== null && u.push(t[d].destructorFunction);
			return rn(e, Kn[qn(t, s, l, a)](...u));
		}
		var Yn = (e, t) => {
			for (var n = [], r = 0; r < e; r++) n.push(x[t + r * 4 >>> 2 >>> 0]);
			return n;
		}, Xn = (e) => {
			e = e.trim();
			let t = e.indexOf("(");
			return t === -1 ? e : e.slice(0, t);
		};
		function Zn(e, t, n, r, i, a, o, s) {
			e >>>= 0, n >>>= 0, r >>>= 0, i >>>= 0, a >>>= 0;
			var c = Yn(t, n);
			e = q(e), e = Xn(e), i = Dn(r, i, o), sn(e, function() {
				An(`Cannot call ${e} due to unbound types`, c);
			}, t - 1), Ft([], c, (n) => {
				var r = [n[0], null].concat(n.slice(1));
				return wn(e, Jn(e, r, null, i, a, o), t - 1), [];
			});
		}
		function Qn(e, t, n, r, i) {
			e >>>= 0, t >>>= 0, n >>>= 0, t = q(t), i === -1 && (i = 4294967295);
			var a = (e) => e;
			if (r === 0) {
				var o = 32 - 8 * n;
				a = (e) => e << o >>> o;
			}
			var s = t.includes("unsigned");
			Y(e, {
				name: t,
				fromWireType: a,
				toWireType: s ? function(e, t) {
					return this.name, t >>> 0;
				} : function(e, t) {
					return this.name, t;
				},
				argPackAdvance: X,
				readValueFromPointer: Ht(t, n, r !== 0),
				destructorFunction: null
			});
		}
		function $n(e, t, n) {
			e >>>= 0, n >>>= 0;
			var r = [
				Int8Array,
				Uint8Array,
				Int16Array,
				Uint16Array,
				Int32Array,
				Uint32Array,
				Float32Array,
				Float64Array,
				BigInt64Array,
				BigUint64Array
			][t];
			function i(e) {
				var t = x[e >>> 2 >>> 0], n = x[e + 4 >>> 2 >>> 0];
				return new r(_.buffer, n, t);
			}
			n = q(n), Y(e, {
				name: n,
				fromWireType: i,
				argPackAdvance: X,
				readValueFromPointer: i
			}, { ignoreDuplicateRegistrations: !0 });
		}
		function er(e, t) {
			e >>>= 0, t >>>= 0, t = q(t);
			var n = !0;
			Y(e, {
				name: t,
				fromWireType(e) {
					var t = x[e >>> 2 >>> 0], r = e + 4, i;
					if (n) for (var a = r, o = 0; o <= t; ++o) {
						var s = r + o;
						if (o == t || v[s >>> 0] == 0) {
							var c = s - a, l = it(a, c);
							i === void 0 ? i = l : (i += "\0", i += l), a = s + 1;
						}
					}
					else {
						for (var u = Array(t), o = 0; o < t; ++o) u[o] = String.fromCharCode(v[r + o >>> 0]);
						i = u.join("");
					}
					return ji(e), i;
				},
				toWireType(e, t) {
					t instanceof ArrayBuffer && (t = new Uint8Array(t));
					var r, i = typeof t == "string";
					i || ArrayBuffer.isView(t) && t.BYTES_PER_ELEMENT == 1 || J("Cannot pass non-string to std::string"), r = n && i ? Ke(t) : t.length;
					var a = Ai(4 + r + 1), o = a + 4;
					if (x[a >>> 2 >>> 0] = r, i) if (n) K(t, o, r + 1);
					else for (var s = 0; s < r; ++s) {
						var c = t.charCodeAt(s);
						c > 255 && (ji(a), J("String has UTF-16 code units that do not fit in 8 bits")), v[o + s >>> 0] = c;
					}
					else v.set(t, o >>> 0);
					return e !== null && e.push(ji, a), a;
				},
				argPackAdvance: X,
				readValueFromPointer: kt,
				destructorFunction(e) {
					ji(e);
				}
			});
		}
		var tr = typeof TextDecoder < "u" ? new TextDecoder("utf-16le") : void 0, nr = (e, t) => {
			for (var n = e, r = n >> 1, i = r + t / 2; !(r >= i) && re[r >>> 0];) ++r;
			if (n = r << 1, n - e > 32 && tr) return tr.decode(v.subarray(e >>> 0, n >>> 0));
			for (var a = "", o = 0; !(o >= t / 2); ++o) {
				var s = y[e + o * 2 >>> 1 >>> 0];
				if (s == 0) break;
				a += String.fromCharCode(s);
			}
			return a;
		}, rr = (e, t, n) => {
			if (n ??= 2147483647, n < 2) return 0;
			n -= 2;
			for (var r = t, i = n < e.length * 2 ? n / 2 : e.length, a = 0; a < i; ++a) {
				var o = e.charCodeAt(a);
				y[t >>> 1 >>> 0] = o, t += 2;
			}
			return y[t >>> 1 >>> 0] = 0, t - r;
		}, ir = (e) => e.length * 2, ar = (e, t) => {
			for (var n = 0, r = ""; !(n >= t / 4);) {
				var i = b[e + n * 4 >>> 2 >>> 0];
				if (i == 0) break;
				if (++n, i >= 65536) {
					var a = i - 65536;
					r += String.fromCharCode(55296 | a >> 10, 56320 | a & 1023);
				} else r += String.fromCharCode(i);
			}
			return r;
		}, or = (e, t, n) => {
			if (t >>>= 0, n ??= 2147483647, n < 4) return 0;
			for (var r = t, i = r + n - 4, a = 0; a < e.length; ++a) {
				var o = e.charCodeAt(a);
				if (o >= 55296 && o <= 57343) {
					var s = e.charCodeAt(++a);
					o = 65536 + ((o & 1023) << 10) | s & 1023;
				}
				if (b[t >>> 2 >>> 0] = o, t += 4, t + 4 > i) break;
			}
			return b[t >>> 2 >>> 0] = 0, t - r;
		}, sr = (e) => {
			for (var t = 0, n = 0; n < e.length; ++n) {
				var r = e.charCodeAt(n);
				r >= 55296 && r <= 57343 && ++n, t += 4;
			}
			return t;
		}, cr = function(e, t, n) {
			e >>>= 0, t >>>= 0, n >>>= 0, n = q(n);
			var r, i, a, o;
			t === 2 ? (r = nr, i = rr, o = ir, a = (e) => re[e >>> 1 >>> 0]) : t === 4 && (r = ar, i = or, o = sr, a = (e) => x[e >>> 2 >>> 0]), Y(e, {
				name: n,
				fromWireType: (e) => {
					for (var n = x[e >>> 2 >>> 0], i, o = e + 4, s = 0; s <= n; ++s) {
						var c = e + 4 + s * t;
						if (s == n || a(c) == 0) {
							var l = c - o, u = r(o, l);
							i === void 0 ? i = u : (i += "\0", i += u), o = c + t;
						}
					}
					return ji(e), i;
				},
				toWireType: (e, r) => {
					typeof r != "string" && J(`Cannot pass non-string to C++ string type ${n}`);
					var a = o(r), s = Ai(4 + a + t);
					return x[s >>> 2 >>> 0] = a / t, i(r, s + 4, a + t), e !== null && e.push(ji, s), s;
				},
				argPackAdvance: X,
				readValueFromPointer: kt,
				destructorFunction(e) {
					ji(e);
				}
			});
		};
		function lr(e, t, n, r, i, a) {
			e >>>= 0, t >>>= 0, n >>>= 0, r >>>= 0, i >>>= 0, a >>>= 0, Dt[e] = {
				name: q(t),
				rawConstructor: Dn(n, r),
				rawDestructor: Dn(i, a),
				fields: []
			};
		}
		function ur(e, t, n, r, i, a, o, s, c, l) {
			e >>>= 0, t >>>= 0, n >>>= 0, r >>>= 0, i >>>= 0, a >>>= 0, o >>>= 0, s >>>= 0, c >>>= 0, l >>>= 0, Dt[e].fields.push({
				fieldName: q(t),
				getterReturnType: n,
				getter: Dn(r, i),
				getterContext: a,
				setterArgumentType: o,
				setter: Dn(s, c),
				setterContext: l
			});
		}
		var dr = function(e, t) {
			e >>>= 0, t >>>= 0, t = q(t), Y(e, {
				isVoid: !0,
				name: t,
				argPackAdvance: 0,
				fromWireType: () => void 0,
				toWireType: (e, t) => void 0
			});
		}, fr = 0, pr = () => {
			j = !1, fr = 0;
		};
		function mr(e) {
			return e >>>= 0, e ? -52 : 0;
		}
		var hr = () => {
			throw Infinity;
		}, gr = {}, _r = (e) => {
			var t = gr[e];
			return t === void 0 ? q(e) : t;
		}, vr = [];
		function yr(e, t, n, r, i) {
			return e >>>= 0, t >>>= 0, n >>>= 0, r >>>= 0, i >>>= 0, e = vr[e], t = Z.toValue(t), n = _r(n), e(t, t[n], r, i);
		}
		var br = (e) => {
			var t = vr.length;
			return vr.push(e), t;
		}, xr = (e, t) => {
			for (var n = Array(e), r = 0; r < e; ++r) n[r] = Vn(x[t + r * 4 >>> 2 >>> 0], `parameter ${r}`);
			return n;
		}, Sr = (e, t, n) => {
			var r = [], i = e.toWireType(r, n);
			return r.length && (x[t >>> 2 >>> 0] = Z.toHandle(r)), i;
		}, Cr = Reflect.construct, wr = function(e, t, n) {
			t >>>= 0;
			var r = xr(e, t), i = r.shift();
			e--;
			var a = Array(e);
			return br(rn(`methodCaller<(${r.map((e) => e.name).join(", ")}) => ${i.name}>`, (t, o, s, c) => {
				for (var l = 0, u = 0; u < e; ++u) a[u] = r[u].readValueFromPointer(c + l), l += r[u].argPackAdvance;
				return Sr(i, s, n === 1 ? Cr(o, a) : o.apply(t, a));
			}));
		};
		function Tr(e) {
			e >>>= 0, e > 9 && (Nn[e + 1] += 1);
		}
		function Er() {
			return Z.toHandle([]);
		}
		function Dr(e) {
			return e >>>= 0, Z.toHandle(_r(e));
		}
		function Or() {
			return Z.toHandle({});
		}
		function kr(e) {
			e >>>= 0, Ot(Z.toValue(e)), Pn(e);
		}
		function Ar(e, t, n) {
			e >>>= 0, t >>>= 0, n >>>= 0, e = Z.toValue(e), t = Z.toValue(t), n = Z.toValue(n), e[t] = n;
		}
		function jr(e, t) {
			e >>>= 0, t >>>= 0, e = Vn(e, "_emval_take_value");
			var n = e.readValueFromPointer(t);
			return Z.toHandle(n);
		}
		function Mr(e, t) {
			e = P(e), t >>>= 0;
			var n = /* @__PURE__ */ new Date(e * 1e3);
			b[t >>> 2 >>> 0] = n.getUTCSeconds(), b[t + 4 >>> 2 >>> 0] = n.getUTCMinutes(), b[t + 8 >>> 2 >>> 0] = n.getUTCHours(), b[t + 12 >>> 2 >>> 0] = n.getUTCDate(), b[t + 16 >>> 2 >>> 0] = n.getUTCMonth(), b[t + 20 >>> 2 >>> 0] = n.getUTCFullYear() - 1900, b[t + 24 >>> 2 >>> 0] = n.getUTCDay();
			var r = Date.UTC(n.getUTCFullYear(), 0, 1, 0, 0, 0, 0), i = (n.getTime() - r) / (1e3 * 60 * 60 * 24) | 0;
			b[t + 28 >>> 2 >>> 0] = i;
		}
		var Nr = (e) => e % 4 == 0 && (e % 100 != 0 || e % 400 == 0), Pr = [
			0,
			31,
			60,
			91,
			121,
			152,
			182,
			213,
			244,
			274,
			305,
			335
		], Fr = [
			0,
			31,
			59,
			90,
			120,
			151,
			181,
			212,
			243,
			273,
			304,
			334
		], Ir = (e) => (Nr(e.getFullYear()) ? Pr : Fr)[e.getMonth()] + e.getDate() - 1;
		function Lr(e, t) {
			e = P(e), t >>>= 0;
			var n = /* @__PURE__ */ new Date(e * 1e3);
			b[t >>> 2 >>> 0] = n.getSeconds(), b[t + 4 >>> 2 >>> 0] = n.getMinutes(), b[t + 8 >>> 2 >>> 0] = n.getHours(), b[t + 12 >>> 2 >>> 0] = n.getDate(), b[t + 16 >>> 2 >>> 0] = n.getMonth(), b[t + 20 >>> 2 >>> 0] = n.getFullYear() - 1900, b[t + 24 >>> 2 >>> 0] = n.getDay();
			var r = Ir(n) | 0;
			b[t + 28 >>> 2 >>> 0] = r, b[t + 36 >>> 2 >>> 0] = -(n.getTimezoneOffset() * 60);
			var i = new Date(n.getFullYear(), 0, 1), a = new Date(n.getFullYear(), 6, 1).getTimezoneOffset(), o = i.getTimezoneOffset(), s = (a != o && n.getTimezoneOffset() == Math.min(o, a)) | 0;
			b[t + 32 >>> 2 >>> 0] = s;
		}
		var Rr = function(e) {
			e >>>= 0;
			var t = (() => {
				var t = new Date(b[e + 20 >>> 2 >>> 0] + 1900, b[e + 16 >>> 2 >>> 0], b[e + 12 >>> 2 >>> 0], b[e + 8 >>> 2 >>> 0], b[e + 4 >>> 2 >>> 0], b[e >>> 2 >>> 0], 0), n = b[e + 32 >>> 2 >>> 0], r = t.getTimezoneOffset(), i = new Date(t.getFullYear(), 0, 1), a = new Date(t.getFullYear(), 6, 1).getTimezoneOffset(), o = i.getTimezoneOffset(), s = Math.min(o, a);
				if (n < 0) b[e + 32 >>> 2 >>> 0] = Number(a != o && s == r);
				else if (n > 0 != (s == r)) {
					var c = n > 0 ? s : Math.max(o, a);
					t.setTime(t.getTime() + (c - r) * 6e4);
				}
				b[e + 24 >>> 2 >>> 0] = t.getDay();
				var l = Ir(t) | 0;
				b[e + 28 >>> 2 >>> 0] = l, b[e >>> 2 >>> 0] = t.getSeconds(), b[e + 4 >>> 2 >>> 0] = t.getMinutes(), b[e + 8 >>> 2 >>> 0] = t.getHours(), b[e + 12 >>> 2 >>> 0] = t.getDate(), b[e + 16 >>> 2 >>> 0] = t.getMonth(), b[e + 20 >>> 2 >>> 0] = t.getYear();
				var u = t.getTime();
				return isNaN(u) ? -1 : u / 1e3;
			})();
			return BigInt(t);
		};
		function zr(e, t, n, r, i, a, o) {
			e >>>= 0, i = P(i), a >>>= 0, o >>>= 0;
			try {
				if (isNaN(i)) return 61;
				var s = G.getStreamFromFD(r), c = W.mmap(s, e, i, t, n), l = c.ptr;
				return b[a >>> 2 >>> 0] = c.allocated, x[o >>> 2 >>> 0] = l, 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		function Br(e, t, n, r, i, a) {
			e >>>= 0, t >>>= 0, a = P(a);
			try {
				var o = G.getStreamFromFD(i);
				n & 2 && G.doMsync(e, o, t, r, a);
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return -e.errno;
			}
		}
		var Vr = function(e, t, n, r) {
			e >>>= 0, t >>>= 0, n >>>= 0, r >>>= 0;
			var i = (/* @__PURE__ */ new Date()).getFullYear(), a = new Date(i, 0, 1), o = new Date(i, 6, 1), s = a.getTimezoneOffset(), c = o.getTimezoneOffset(), l = Math.max(s, c);
			x[e >>> 2 >>> 0] = l * 60, b[t >>> 2 >>> 0] = Number(s != c);
			var u = (e) => {
				var t = e >= 0 ? "-" : "+", n = Math.abs(e);
				return `UTC${t}${String(Math.floor(n / 60)).padStart(2, "0")}${String(n % 60).padStart(2, "0")}`;
			}, d = u(s), f = u(c);
			c < s ? (K(d, n, 17), K(f, r, 17)) : (K(d, r, 17), K(f, n, 17));
		}, Hr = () => performance.now(), Ur = () => Date.now(), Wr = 1, Gr = (e) => e >= 0 && e <= 3;
		function Kr(e, t, n) {
			if (t = P(t), n >>>= 0, !Gr(e)) return 28;
			var r;
			if (e === 0) r = Ur();
			else if (Wr) r = Hr();
			else return 52;
			var i = Math.round(r * 1e3 * 1e3);
			return S[n >>> 3] = BigInt(i), 0;
		}
		var qr = () => 4294901760;
		function Jr() {
			return qr();
		}
		var Yr = (e) => {
			var t = (e - g.buffer.byteLength + 65535) / 65536 | 0;
			try {
				return g.grow(t), w(), 1;
			} catch {}
		};
		function Xr(e) {
			e >>>= 0;
			var t = v.length, n = qr();
			if (e > n) return !1;
			for (var r = 1; r <= 4; r *= 2) {
				var i = t * (1 + .2 / r);
				if (i = Math.min(i, e + 100663296), Yr(Math.min(n, Xe(Math.max(e, i), 65536)))) return !0;
			}
			return !1;
		}
		var Zr = {}, Qr = () => l || "./this.program", $r = () => {
			if (!$r.strings) {
				var e = {
					USER: "web_user",
					LOGNAME: "web_user",
					PATH: "/",
					PWD: "/",
					HOME: "/home/web_user",
					LANG: (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8",
					_: Qr()
				};
				for (var t in Zr) Zr[t] === void 0 ? delete e[t] : e[t] = Zr[t];
				var n = [];
				for (var t in e) n.push(`${t}=${e[t]}`);
				$r.strings = n;
			}
			return $r.strings;
		};
		function ei(e, t) {
			e >>>= 0, t >>>= 0;
			var n = 0, r = 0;
			for (var i of $r()) {
				var a = t + n;
				x[e + r >>> 2 >>> 0] = a, n += K(i, a, Infinity) + 1, r += 4;
			}
			return 0;
		}
		function ti(e, t) {
			e >>>= 0, t >>>= 0;
			var n = $r();
			x[e >>> 2 >>> 0] = n.length;
			var r = 0;
			for (var i of n) r += Ke(i) + 1;
			return x[t >>> 2 >>> 0] = r, 0;
		}
		var ni = () => j || fr > 0, ri = (e) => {
			ni() || (r.onExit?.(e), ne = !0), u(e, new ve(e));
		}, ii = (e, t) => {
			ri(e);
		};
		function ai(e) {
			try {
				var t = G.getStreamFromFD(e);
				return W.close(t), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		function oi(e, t) {
			t >>>= 0;
			try {
				var n = 0, r = 0, i = 0, a = G.getStreamFromFD(e), o = a.tty ? 2 : W.isDir(a.mode) ? 3 : W.isLink(a.mode) ? 7 : 4;
				return _[t >>> 0] = o, y[t + 2 >>> 1 >>> 0] = i, S[t + 8 >>> 3] = BigInt(n), S[t + 16 >>> 3] = BigInt(r), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		var si = (e, t, n, r) => {
			for (var i = 0, a = 0; a < n; a++) {
				var o = x[t >>> 2 >>> 0], s = x[t + 4 >>> 2 >>> 0];
				t += 8;
				var c = W.read(e, _, o, s, r);
				if (c < 0) return -1;
				if (i += c, c < s) break;
				r !== void 0 && (r += c);
			}
			return i;
		};
		function ci(e, t, n, r, i) {
			t >>>= 0, n >>>= 0, r = P(r), i >>>= 0;
			try {
				if (isNaN(r)) return 61;
				var a = si(G.getStreamFromFD(e), t, n, r);
				return x[i >>> 2 >>> 0] = a, 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		var li = (e, t, n, r) => {
			for (var i = 0, a = 0; a < n; a++) {
				var o = x[t >>> 2 >>> 0], s = x[t + 4 >>> 2 >>> 0];
				t += 8;
				var c = W.write(e, _, o, s, r);
				if (c < 0) return -1;
				if (i += c, c < s) break;
				r !== void 0 && (r += c);
			}
			return i;
		};
		function ui(e, t, n, r, i) {
			t >>>= 0, n >>>= 0, r = P(r), i >>>= 0;
			try {
				if (isNaN(r)) return 61;
				var a = li(G.getStreamFromFD(e), t, n, r);
				return x[i >>> 2 >>> 0] = a, 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		function di(e, t, n, r) {
			t >>>= 0, n >>>= 0, r >>>= 0;
			try {
				var i = si(G.getStreamFromFD(e), t, n);
				return x[r >>> 2 >>> 0] = i, 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		function fi(e, t, n, r) {
			t = P(t), r >>>= 0;
			try {
				if (isNaN(t)) return 61;
				var i = G.getStreamFromFD(e);
				return W.llseek(i, t, n), S[r >>> 3] = BigInt(i.position), i.getdents && t === 0 && n === 0 && (i.getdents = null), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		function pi(e) {
			try {
				var t = G.getStreamFromFD(e);
				return t.stream_ops?.fsync ? t.stream_ops.fsync(t) : 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		function mi(e, t, n, r) {
			t >>>= 0, n >>>= 0, r >>>= 0;
			try {
				var i = li(G.getStreamFromFD(e), t, n);
				return x[r >>> 2 >>> 0] = i, 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		function hi(e) {
			return e >>>= 0, e;
		}
		function gi(e, t) {
			e >>>= 0, t >>>= 0;
			try {
				return He(v.subarray(e >>> 0, e + t >>> 0)), 0;
			} catch (e) {
				if (W === void 0 || e.name !== "ErrnoError") throw e;
				return e.errno;
			}
		}
		var _i = (e, t) => {
			e < 128 ? t.push(e) : t.push(e % 128 | 128, e >> 7);
		}, vi = (e) => {
			for (var t = {
				i: "i32",
				j: "i64",
				f: "f32",
				d: "f64",
				e: "externref",
				p: "i32"
			}, n = {
				parameters: [],
				results: e[0] == "v" ? [] : [t[e[0]]]
			}, r = 1; r < e.length; ++r) n.parameters.push(t[e[r]]);
			return n;
		}, yi = (e, t) => {
			var n = e.slice(0, 1), r = e.slice(1), i = {
				i: 127,
				p: 127,
				j: 126,
				f: 125,
				d: 124,
				e: 111
			};
			t.push(96), _i(r.length, t);
			for (var a of r) t.push(i[a]);
			n == "v" ? t.push(0) : t.push(1, i[n]);
		}, bi = (e, t) => {
			if (typeof WebAssembly.Function == "function") return new WebAssembly.Function(vi(t), e);
			var n = [1];
			yi(t, n);
			var r = [
				0,
				97,
				115,
				109,
				1,
				0,
				0,
				0,
				1
			];
			_i(n.length, r), r.push(...n), r.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
			var i = new WebAssembly.Module(new Uint8Array(r));
			return new WebAssembly.Instance(i, { e: { f: e } }).exports.f;
		}, xi = (e, t) => {
			if (Si) for (var n = e; n < e + t; n++) {
				var r = F(n);
				r && Si.set(r, n);
			}
		}, Si, Ci = (e) => (Si || (Si = /* @__PURE__ */ new WeakMap(), xi(0, ke.length)), Si.get(e) || 0), wi = [], Ti = () => {
			if (wi.length) return wi.pop();
			try {
				ke.grow(1);
			} catch (e) {
				throw e instanceof RangeError ? "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH." : e;
			}
			return ke.length - 1;
		}, Ei = (e, t) => {
			ke.set(e, t), Oe[e] = ke.get(e);
		}, Di = (e, t) => {
			var n = Ci(e);
			if (n) return n;
			var r = Ti();
			try {
				Ei(r, e);
			} catch (n) {
				if (!(n instanceof TypeError)) throw n;
				Ei(r, bi(e, t));
			}
			return Si.set(e, r), r;
		};
		W.createPreloadedFile = tt, W.staticInit(), H.doesNotExistError = new W.ErrnoError(44), H.doesNotExistError.stack = "<generic error, no stack>", Rt(), tn(), Sn(), In(), r.noExitRuntime && (j = r.noExitRuntime), r.preloadPlugins && ($e = r.preloadPlugins), r.print && (m = r.print), r.printErr && (h = r.printErr), r.wasmBinary && (te = r.wasmBinary), r.arguments && r.arguments, r.thisProgram && (l = r.thisProgram), r.addFunction = Di, r.setValue = Te, r.getValue = we, r.UTF8ToString = it, r.stringToUTF8 = K, r.lengthBytesUTF8 = Ke, r.FS = W;
		var Oi = {
			cb: Ae,
			za: Me,
			R: Pe,
			z: Le,
			Ba: Re,
			a: ze,
			y: Be,
			sa: at,
			qa: ot,
			ta: st,
			$: ct,
			pa: lt,
			H: ft,
			oa: pt,
			ja: mt,
			bb: ht,
			wa: gt,
			la: _t,
			ma: vt,
			F: yt,
			ab: bt,
			_a: xt,
			$a: St,
			na: Ct,
			Za: wt,
			_: Tt,
			ua: Et,
			Oa: It,
			U: Ut,
			Ia: Wt,
			M: jn,
			Ga: Rn,
			x: Bn,
			e: Hn,
			T: Wn,
			m: Zn,
			w: Qn,
			p: $n,
			Ha: er,
			J: cr,
			Pa: lr,
			L: ur,
			Ja: dr,
			db: pr,
			Xa: mr,
			Va: hr,
			La: yr,
			l: Pn,
			Ma: wr,
			Na: Tr,
			K: Er,
			t: Dr,
			D: Or,
			Ka: kr,
			r: Ar,
			o: jr,
			ca: Mr,
			da: Lr,
			ea: Rr,
			aa: zr,
			ba: Br,
			fa: Vr,
			ra: Kr,
			P: Ur,
			Ya: Jr,
			E: Hr,
			Wa: Xr,
			xa: ei,
			ya: ti,
			C: ii,
			B: ai,
			O: oi,
			fb: ci,
			eb: ui,
			Q: di,
			ga: fi,
			ka: pi,
			G: mi,
			Sa: ra,
			A: $i,
			c: Ui,
			d: Hi,
			h: Vi,
			j: qi,
			Z: na,
			b: Zi,
			N: oa,
			n: Xi,
			Ra: sa,
			Qa: ua,
			Fa: ma,
			Ea: ha,
			s: Qi,
			Ua: ea,
			I: ga,
			u: Yi,
			ha: Ji,
			v: ia,
			k: Wi,
			f: Gi,
			Y: ca,
			X: la,
			i: Bi,
			g: Ki,
			q: aa,
			V: fa,
			S: pa,
			Da: _a,
			W: da,
			Ca: va,
			Ta: ta,
			Aa: hi,
			va: ri,
			ia: gi
		}, Q = await A();
		Q.hb;
		var ki = Q.ib;
		r._MagickColor_Create = Q.jb, r._MagickColor_Dispose = Q.kb, r._MagickColor_Count_Get = Q.lb, r._MagickColor_Red_Get = Q.mb, r._MagickColor_Red_Set = Q.nb, r._MagickColor_Green_Get = Q.ob, r._MagickColor_Green_Set = Q.pb, r._MagickColor_Blue_Get = Q.qb, r._MagickColor_Blue_Set = Q.rb, r._MagickColor_Alpha_Get = Q.sb, r._MagickColor_Alpha_Set = Q.tb, r._MagickColor_Black_Get = Q.ub, r._MagickColor_Black_Set = Q.vb, r._MagickColor_IsCMYK_Get = Q.wb, r._MagickColor_IsCMYK_Set = Q.xb, r._MagickColor_Clone = Q.yb, r._MagickColor_FuzzyEquals = Q.zb, r._MagickColor_Initialize = Q.Ab, r._MagickColorCollection_DisposeList = Q.Cb, r._MagickColorCollection_GetInstance = Q.Db, r._DrawingWand_Create = Q.Eb, r._DrawingWand_Dispose = Q.Fb, r._DrawingWand_Affine = Q.Gb, r._DrawingWand_Alpha = Q.Hb, r._DrawingWand_Arc = Q.Ib, r._DrawingWand_Bezier = Q.Jb, r._DrawingWand_BorderColor = Q.Kb, r._DrawingWand_Circle = Q.Lb, r._DrawingWand_ClipPath = Q.Mb, r._DrawingWand_ClipRule = Q.Nb, r._DrawingWand_ClipUnits = Q.Ob, r._DrawingWand_Color = Q.Pb, r._DrawingWand_Composite = Q.Qb, r._DrawingWand_Density = Q.Rb, r._DrawingWand_Ellipse = Q.Sb, r._DrawingWand_FillColor = Q.Tb, r._DrawingWand_FillOpacity = Q.Ub, r._DrawingWand_FillPatternUrl = Q.Vb, r._DrawingWand_FillRule = Q.Wb, r._DrawingWand_Font = Q.Xb, r._DrawingWand_FontFamily = Q.Yb, r._DrawingWand_FontPointSize = Q.Zb, r._DrawingWand_FontTypeMetrics = Q._b, r._TypeMetric_Create = Q.$b, r._DrawingWand_Gravity = Q.ac, r._DrawingWand_Line = Q.bc, r._DrawingWand_PathArcAbs = Q.cc, r._DrawingWand_PathArcRel = Q.dc, r._DrawingWand_PathClose = Q.ec, r._DrawingWand_PathCurveToAbs = Q.fc, r._DrawingWand_PathCurveToRel = Q.gc, r._DrawingWand_PathFinish = Q.hc, r._DrawingWand_PathLineToAbs = Q.ic, r._DrawingWand_PathLineToHorizontalAbs = Q.jc, r._DrawingWand_PathLineToHorizontalRel = Q.kc, r._DrawingWand_PathLineToRel = Q.lc, r._DrawingWand_PathLineToVerticalAbs = Q.mc, r._DrawingWand_PathLineToVerticalRel = Q.nc, r._DrawingWand_PathMoveToAbs = Q.oc, r._DrawingWand_PathMoveToRel = Q.pc, r._DrawingWand_PathQuadraticCurveToAbs = Q.qc, r._DrawingWand_PathQuadraticCurveToRel = Q.rc, r._DrawingWand_PathSmoothCurveToAbs = Q.sc, r._DrawingWand_PathSmoothCurveToRel = Q.tc, r._DrawingWand_PathSmoothQuadraticCurveToAbs = Q.uc, r._DrawingWand_PathSmoothQuadraticCurveToRel = Q.vc, r._DrawingWand_PathStart = Q.wc, r._DrawingWand_Point = Q.xc, r._DrawingWand_Polygon = Q.yc, r._DrawingWand_Polyline = Q.zc, r._DrawingWand_PopClipPath = Q.Ac, r._DrawingWand_PopGraphicContext = Q.Bc, r._DrawingWand_PopPattern = Q.Cc, r._DrawingWand_PushClipPath = Q.Dc, r._DrawingWand_PushGraphicContext = Q.Ec, r._DrawingWand_PushPattern = Q.Fc, r._DrawingWand_Rectangle = Q.Gc, r._DrawingWand_Render = Q.Hc, r._DrawingWand_Rotation = Q.Ic, r._DrawingWand_RoundRectangle = Q.Jc, r._DrawingWand_Scaling = Q.Kc, r._DrawingWand_SkewX = Q.Lc, r._DrawingWand_SkewY = Q.Mc, r._DrawingWand_StrokeAntialias = Q.Nc, r._DrawingWand_StrokeColor = Q.Oc, r._DrawingWand_StrokeDashArray = Q.Pc, r._DrawingWand_StrokeDashOffset = Q.Qc, r._DrawingWand_StrokeLineCap = Q.Rc, r._DrawingWand_StrokeLineJoin = Q.Sc, r._DrawingWand_StrokeMiterLimit = Q.Tc, r._DrawingWand_StrokeOpacity = Q.Uc, r._DrawingWand_StrokePatternUrl = Q.Vc, r._DrawingWand_StrokeWidth = Q.Wc, r._DrawingWand_Text = Q.Xc, r._DrawingWand_TextAlignment = Q.Yc, r._DrawingWand_TextAntialias = Q.Zc, r._DrawingWand_TextDecoration = Q._c, r._DrawingWand_TextDirection = Q.$c, r._DrawingWand_TextEncoding = Q.ad, r._DrawingWand_TextInterlineSpacing = Q.bd, r._DrawingWand_TextInterwordSpacing = Q.cd, r._DrawingWand_TextKerning = Q.dd, r._DrawingWand_TextUnderColor = Q.ed, r._DrawingWand_Translation = Q.fd, r._DrawingWand_Viewbox = Q.gd, r._MagickExceptionHelper_Description = Q.hd, r._MagickExceptionHelper_Dispose = Q.id, r._MagickExceptionHelper_Related = Q.jd, r._MagickExceptionHelper_RelatedCount = Q.kd, r._MagickExceptionHelper_Message = Q.ld, r._MagickExceptionHelper_Severity = Q.md, r._PdfInfo_PageCount = Q.nd, r._Environment_Initialize = Q.od, r._Environment_GetEnv = Q.pd, r._Environment_SetEnv = Q.qd, r._MagickMemory_Relinquish = Q.rd, r._Magick_Delegates_Get = Q.sd, r._Magick_Features_Get = Q.td, r._Magick_ImageMagickVersion_Get = Q.ud, r._Magick_GetFonts = Q.vd, r._Magick_GetFontFamily = Q.wd, r._Magick_GetFontName = Q.xd, r._Magick_GetWindowsResource = Q.yd, r._Magick_DisposeFonts = Q.zd, r._Magick_ResetRandomSeed = Q.Ad, r._Magick_SetDefaultFontFile = Q.Bd, r._Magick_SetRandomSeed = Q.Cd, r._Magick_SetLogDelegate = Q.Dd, r._Magick_SetLogEvents = Q.Ed, r._MagickFormatInfo_CreateList = Q.Fd, r._MagickFormatInfo_DisposeList = Q.Gd, r._MagickFormatInfo_CanReadMultithreaded_Get = Q.Hd, r._MagickFormatInfo_CanWriteMultithreaded_Get = Q.Id, r._MagickFormatInfo_Description_Get = Q.Jd, r._MagickFormatInfo_Format_Get = Q.Kd, r._MagickFormatInfo_MimeType_Get = Q.Ld, r._MagickFormatInfo_Module_Get = Q.Md, r._MagickFormatInfo_SupportsMultipleFrames_Get = Q.Nd, r._MagickFormatInfo_SupportsReading_Get = Q.Od, r._MagickFormatInfo_SupportsWriting_Get = Q.Pd, r._MagickFormatInfo_GetInfo = Q.Qd, r._MagickFormatInfo_GetInfoByName = Q.Rd, r._MagickFormatInfo_GetInfoWithBlob = Q.Sd, r._MagickFormatInfo_Unregister = Q.Td, r._MagickImage_Create = Q.Ud, r._MagickImage_Dispose = Q.Vd, r._MagickImage_AnimationDelay_Get = Q.Wd, r._MagickImage_AnimationDelay_Set = Q.Xd, r._MagickImage_AnimationIterations_Get = Q.Yd, r._MagickImage_AnimationIterations_Set = Q.Zd, r._MagickImage_AnimationTicksPerSecond_Get = Q._d, r._MagickImage_AnimationTicksPerSecond_Set = Q.$d, r._MagickImage_BackgroundColor_Get = Q.ae, r._MagickImage_BackgroundColor_Set = Q.be, r._MagickImage_BaseHeight_Get = Q.ce, r._MagickImage_BaseWidth_Get = Q.de, r._MagickImage_BlackPointCompensation_Get = Q.ee, r._MagickImage_BlackPointCompensation_Set = Q.fe, r._MagickImage_BorderColor_Get = Q.ge, r._MagickImage_BorderColor_Set = Q.he, r._MagickImage_BoundingBox_Get = Q.ie, r._MagickRectangle_Create = Q.je, r._MagickImage_ChannelCount_Get = Q.ke, r._MagickImage_ChromaBlue_Get = Q.le, r._PrimaryInfo_Create = Q.me, r._MagickImage_ChromaBlue_Set = Q.ne, r._MagickImage_ChromaGreen_Get = Q.oe, r._MagickImage_ChromaGreen_Set = Q.pe, r._MagickImage_ChromaRed_Get = Q.qe, r._MagickImage_ChromaRed_Set = Q.re, r._MagickImage_ChromaWhite_Get = Q.se, r._MagickImage_ChromaWhite_Set = Q.te, r._MagickImage_ClassType_Get = Q.ue, r._MagickImage_ClassType_Set = Q.ve, r._QuantizeSettings_Create = Q.we, r._QuantizeSettings_Dispose = Q.xe, r._MagickImage_ColorFuzz_Get = Q.ye, r._MagickImage_ColorFuzz_Set = Q.ze, r._MagickImage_ColormapSize_Get = Q.Ae, r._MagickImage_ColormapSize_Set = Q.Be, r._MagickImage_ColorSpace_Get = Q.Ce, r._MagickImage_ColorSpace_Set = Q.De, r._MagickImage_ColorType_Get = Q.Ee, r._MagickImage_ColorType_Set = Q.Fe, r._MagickImage_Compose_Get = Q.Ge, r._MagickImage_Compose_Set = Q.He, r._MagickImage_Compression_Get = Q.Ie, r._MagickImage_Compression_Set = Q.Je, r._MagickImage_Depth_Get = Q.Ke, r._MagickImage_Depth_Set = Q.Le, r._MagickImage_EncodingGeometry_Get = Q.Me, r._MagickImage_Endian_Get = Q.Ne, r._MagickImage_Endian_Set = Q.Oe, r._MagickImage_FileName_Get = Q.Pe, r._MagickImage_FileName_Set = Q.Qe, r._MagickImage_FilterType_Get = Q.Re, r._MagickImage_FilterType_Set = Q.Se, r._MagickImage_Format_Get = Q.Te, r._MagickImage_Format_Set = Q.Ue, r._MagickImage_Gamma_Get = Q.Ve, r._MagickImage_GifDisposeMethod_Get = Q.We, r._MagickImage_GifDisposeMethod_Set = Q.Xe, r._MagickImage_HasAlpha_Get = Q.Ye, r._MagickImage_HasAlpha_Set = Q.Ze, r._MagickImage_Height_Get = Q._e, r._MagickImage_Interlace_Get = Q.$e, r._MagickImage_Interlace_Set = Q.af, r._MagickImage_Interpolate_Get = Q.bf, r._MagickImage_Interpolate_Set = Q.cf, r._MagickImage_IsOpaque_Get = Q.df, r._MagickImage_MatteColor_Get = Q.ef, r._MagickImage_MatteColor_Set = Q.ff, r._MagickImage_MeanErrorPerPixel_Get = Q.gf, r._MagickImage_MetaChannelCount_Get = Q.hf, r._MagickImage_MetaChannelCount_Set = Q.jf, r._MagickImage_NormalizedMaximumError_Get = Q.kf, r._MagickImage_NormalizedMeanError_Get = Q.lf, r._MagickImage_Orientation_Get = Q.mf, r._MagickImage_Orientation_Set = Q.nf, r._MagickImage_Page_Get = Q.of, r._MagickImage_Page_Set = Q.pf, r._MagickImage_Quality_Get = Q.qf, r._MagickImage_Quality_Set = Q.rf, r._MagickImage_RenderingIntent_Get = Q.sf, r._MagickImage_RenderingIntent_Set = Q.tf, r._MagickImage_ResolutionUnits_Get = Q.uf, r._MagickImage_ResolutionUnits_Set = Q.vf, r._MagickImage_ResolutionX_Get = Q.wf, r._MagickImage_ResolutionX_Set = Q.xf, r._MagickImage_ResolutionY_Get = Q.yf, r._MagickImage_ResolutionY_Set = Q.zf, r._MagickImage_Signature_Get = Q.Af, r._MagickImage_TotalColors_Get = Q.Bf, r._MagickImage_VirtualPixelMethod_Get = Q.Cf, r._MagickImage_VirtualPixelMethod_Set = Q.Df, r._MagickImage_Width_Get = Q.Ef, r._MagickImage_AdaptiveBlur = Q.Ff, r._MagickImage_AdaptiveResize = Q.Gf, r._MagickImage_AdaptiveSharpen = Q.Hf, r._MagickImage_AdaptiveThreshold = Q.If, r._MagickImage_AddNoise = Q.Jf, r._MagickImage_AffineTransform = Q.Kf, r._MagickImage_Annotate = Q.Lf, r._MagickImage_AutoGamma = Q.Mf, r._MagickImage_AutoLevel = Q.Nf, r._MagickImage_AutoOrient = Q.Of, r._MagickImage_AutoThreshold = Q.Pf, r._MagickImage_BilateralBlur = Q.Qf, r._MagickImage_BlackThreshold = Q.Rf, r._MagickImage_BlueShift = Q.Sf, r._MagickImage_Blur = Q.Tf, r._MagickImage_Border = Q.Uf, r._MagickImage_BrightnessContrast = Q.Vf, r._MagickImage_CannyEdge = Q.Wf, r._MagickImage_ChannelOffset = Q.Xf, r._MagickImage_Charcoal = Q.Yf, r._MagickImage_Chop = Q.Zf, r._MagickImage_Clahe = Q._f, r._MagickImage_Clamp = Q.$f, r._MagickImage_ClipPath = Q.ag, r._MagickImage_Clone = Q.bg, r._MagickImage_CloneArea = Q.cg, r._MagickImage_Clut = Q.dg, r._MagickImage_ColorDecisionList = Q.eg, r._MagickImage_Colorize = Q.fg, r._MagickImage_ColorMatrix = Q.gg, r._MagickImage_ColorThreshold = Q.hg, r._MagickImage_Compare = Q.ig, r._MagickImage_CompareDistortion = Q.jg, r._MagickImage_Composite = Q.kg, r._MagickImage_CompositeGravity = Q.lg, r._MagickImage_ConnectedComponents = Q.mg, r._MagickImage_Contrast = Q.ng, r._MagickImage_ContrastStretch = Q.og, r._MagickImage_ConvexHull = Q.pg, r._MagickImage_Convolve = Q.qg, r._MagickImage_CopyPixels = Q.rg, r._MagickImage_Crop = Q.sg, r._MagickImage_CropToTiles = Q.tg, r._MagickImage_CycleColormap = Q.ug, r._MagickImage_Decipher = Q.vg, r._MagickImage_Deskew = Q.wg, r._MagickImage_Despeckle = Q.xg, r._MagickImage_DetermineBitDepth = Q.yg, r._MagickImage_DetermineColorType = Q.zg, r._MagickImage_Distort = Q.Ag, r._MagickImage_Edge = Q.Bg, r._MagickImage_Emboss = Q.Cg, r._MagickImage_Encipher = Q.Dg, r._MagickImage_Enhance = Q.Eg, r._MagickImage_Equalize = Q.Fg, r._MagickImage_Equals = Q.Gg, r._MagickImage_EvaluateFunction = Q.Hg, r._MagickImage_EvaluateGeometry = Q.Ig, r._MagickImage_EvaluateOperator = Q.Jg, r._MagickImage_Extent = Q.Kg, r._MagickImage_Flip = Q.Lg, r._MagickImage_FloodFill = Q.Mg, r._MagickImage_Flop = Q.Ng, r._MagickImage_FontTypeMetrics = Q.Og, r._MagickImage_FormatExpression = Q.Pg, r._MagickImage_Frame = Q.Qg, r._MagickImage_Fx = Q.Rg, r._MagickImage_GammaCorrect = Q.Sg, r._MagickImage_GaussianBlur = Q.Tg, r._MagickImage_GetArtifact = Q.Ug, r._MagickImage_GetAttribute = Q.Vg, r._MagickImage_GetColormapColor = Q.Wg, r._MagickImage_GetNext = Q.Xg, r._MagickImage_GetNextArtifactName = Q.Yg, r._MagickImage_GetNextAttributeName = Q.Zg, r._MagickImage_GetNextProfileName = Q._g, r._MagickImage_GetProfile = Q.$g, r._MagickImage_GetReadMask = Q.ah, r._MagickImage_GetWriteMask = Q.bh, r._MagickImage_Grayscale = Q.ch, r._MagickImage_HaldClut = Q.dh, r._MagickImage_HasChannel = Q.eh, r._MagickImage_HasProfile = Q.fh, r._MagickImage_Histogram = Q.gh, r._MagickImage_HoughLine = Q.hh, r._MagickImage_Implode = Q.ih, r._MagickImage_ImportPixels = Q.jh, r._MagickImage_Integral = Q.kh, r._MagickImage_InterpolativeResize = Q.lh, r._MagickImage_InverseLevel = Q.mh, r._MagickImage_Kmeans = Q.nh, r._MagickImage_Kuwahara = Q.oh, r._MagickImage_Level = Q.ph, r._MagickImage_LevelColors = Q.qh, r._MagickImage_LinearStretch = Q.rh, r._MagickImage_LiquidRescale = Q.sh, r._MagickImage_LocalContrast = Q.th, r._MagickImage_Magnify = Q.uh, r._MagickImage_MeanShift = Q.vh, r._MagickImage_Minify = Q.wh, r._MagickImage_MinimumBoundingBox = Q.xh, r._MagickImage_Modulate = Q.yh, r._MagickImage_Moments = Q.zh, r._MagickImage_Morphology = Q.Ah, r._MagickImage_MotionBlur = Q.Bh, r._MagickImage_Negate = Q.Ch, r._MagickImage_Normalize = Q.Dh, r._MagickImage_OilPaint = Q.Eh, r._MagickImage_Opaque = Q.Fh, r._MagickImage_OrderedDither = Q.Gh, r._MagickImage_Perceptible = Q.Hh, r._MagickImage_PerceptualHash = Q.Ih, r._MagickImage_Quantize = Q.Jh, r._MagickImage_Polaroid = Q.Kh, r._MagickImage_Posterize = Q.Lh, r._MagickImage_RaiseOrLower = Q.Mh, r._MagickImage_RandomThreshold = Q.Nh, r._MagickImage_RangeThreshold = Q.Oh, r._MagickImage_ReadBlob = Q.Ph, r._MagickImage_ReadFile = Q.Qh, r._MagickImage_ReadPixels = Q.Rh, r._MagickImage_ReadStream = Q.Sh, r._MagickImage_RegionMask = Q.Th, r._MagickImage_Remap = Q.Uh, r._MagickImage_RemoveArtifact = Q.Vh, r._MagickImage_RemoveAttribute = Q.Wh, r._MagickImage_RemoveProfile = Q.Xh, r._MagickImage_ResetArtifactIterator = Q.Yh, r._MagickImage_ResetAttributeIterator = Q.Zh, r._MagickImage_ResetProfileIterator = Q._h, r._MagickImage_Resample = Q.$h, r._MagickImage_Resize = Q.ai, r._MagickImage_Roll = Q.bi, r._MagickImage_Rotate = Q.ci, r._MagickImage_RotationalBlur = Q.di, r._MagickImage_Sample = Q.ei, r._MagickImage_Scale = Q.fi, r._MagickImage_Segment = Q.gi, r._MagickImage_SelectiveBlur = Q.hi, r._MagickImage_Separate = Q.ii, r._MagickImage_SepiaTone = Q.ji, r._MagickImage_SetAlpha = Q.ki, r._MagickImage_SetArtifact = Q.li, r._MagickImage_SetAttribute = Q.mi, r._MagickImage_SetBitDepth = Q.ni, r._MagickImage_SetClientData = Q.oi, r._MagickImage_SetColormapColor = Q.pi, r._MagickImage_SetColorMetric = Q.qi, r._MagickImage_SetNext = Q.ri, r._MagickImage_SetProfile = Q.si, r._MagickImage_SetProgressDelegate = Q.ti, r._MagickImage_SetReadMask = Q.ui, r._MagickImage_SetWriteMask = Q.vi, r._MagickImage_Shade = Q.wi, r._MagickImage_Shadow = Q.xi, r._MagickImage_Sharpen = Q.yi, r._MagickImage_Shave = Q.zi, r._MagickImage_Shear = Q.Ai, r._MagickImage_SigmoidalContrast = Q.Bi, r._MagickImage_SparseColor = Q.Ci, r._MagickImage_Spread = Q.Di, r._MagickImage_Sketch = Q.Ei, r._MagickImage_Solarize = Q.Fi, r._MagickImage_SortPixels = Q.Gi, r._MagickImage_Splice = Q.Hi, r._MagickImage_Statistic = Q.Ii, r._MagickImage_Statistics = Q.Ji, r._MagickImage_Stegano = Q.Ki, r._MagickImage_Stereo = Q.Li, r._MagickImage_Strip = Q.Mi, r._MagickImage_SubImageSearch = Q.Ni, r._MagickImage_Swirl = Q.Oi, r._MagickImage_Texture = Q.Pi, r._MagickImage_Threshold = Q.Qi, r._MagickImage_Thumbnail = Q.Ri, r._MagickImage_Tint = Q.Si, r._MagickImage_Transparent = Q.Ti, r._MagickImage_TransparentChroma = Q.Ui, r._MagickImage_Transpose = Q.Vi, r._MagickImage_Transverse = Q.Wi, r._MagickImage_Trim = Q.Xi, r._MagickImage_UniqueColors = Q.Yi, r._MagickImage_UnsharpMask = Q.Zi, r._MagickImage_Vignette = Q._i, r._MagickImage_Wave = Q.$i, r._MagickImage_WaveletDenoise = Q.aj, r._MagickImage_WhiteBalance = Q.bj, r._MagickImage_WhiteThreshold = Q.cj, r._MagickImage_WriteBlob = Q.dj, r._MagickImage_WriteFile = Q.ej, r._MagickImage_WriteStream = Q.fj, r._MagickImageCollection_Append = Q.gj, r._MagickImageCollection_Coalesce = Q.hj, r._MagickImageCollection_Combine = Q.ij, r._MagickImageCollection_Complex = Q.jj, r._MagickImageCollection_Deconstruct = Q.kj, r._MagickImageCollection_Dispose = Q.lj, r._MagickImageCollection_Evaluate = Q.mj, r._MagickImageCollection_Fx = Q.nj, r._MagickImageCollection_Merge = Q.oj, r._MagickImageCollection_Montage = Q.pj, r._MagickImageCollection_Morph = Q.qj, r._MagickImageCollection_Optimize = Q.rj, r._MagickImageCollection_OptimizePlus = Q.sj, r._MagickImageCollection_OptimizeTransparency = Q.tj, r._MagickImageCollection_Polynomial = Q.uj, r._MagickImageCollection_Quantize = Q.vj, r._MagickImageCollection_ReadBlob = Q.wj, r._MagickImageCollection_ReadFile = Q.xj, r._MagickImageCollection_ReadStream = Q.yj, r._MagickImageCollection_Remap = Q.zj, r._MagickImageCollection_Smush = Q.Aj, r._MagickImageCollection_WriteFile = Q.Bj, r._MagickImageCollection_WriteStream = Q.Cj, r._DoubleMatrix_Create = Q.Dj, r._DoubleMatrix_Dispose = Q.Ej, r._OpenCL_GetDevices = Q.Fj, r._OpenCL_GetDevice = Q.Gj, r._OpenCL_GetEnabled = Q.Hj, r._OpenCL_SetEnabled = Q.Ij, r._OpenCLDevice_DeviceType_Get = Q.Jj, r._OpenCLDevice_BenchmarkScore_Get = Q.Kj, r._OpenCLDevice_IsEnabled_Get = Q.Lj, r._OpenCLDevice_IsEnabled_Set = Q.Mj, r._OpenCLDevice_Name_Get = Q.Nj, r._OpenCLDevice_Version_Get = Q.Oj, r._OpenCLDevice_GetKernelProfileRecords = Q.Pj, r._OpenCLDevice_GetKernelProfileRecord = Q.Qj, r._OpenCLDevice_SetProfileKernels = Q.Rj, r._OpenCLKernelProfileRecord_Count_Get = Q.Sj, r._OpenCLKernelProfileRecord_Name_Get = Q.Tj, r._OpenCLKernelProfileRecord_MaximumDuration_Get = Q.Uj, r._OpenCLKernelProfileRecord_MinimumDuration_Get = Q.Vj, r._OpenCLKernelProfileRecord_TotalDuration_Get = Q.Wj, r._JpegOptimizer_CompressFile = Q.Xj, r._JpegOptimizer_CompressStream = Q.Yj;
		var Ai = r._malloc = Q.Zj, ji = r._free = Q._j;
		r._PixelCollection_Create = Q.$j, r._PixelCollection_Dispose = Q.ak, r._PixelCollection_GetArea = Q.bk, r._PixelCollection_GetReadOnlyArea = Q.ck, r._PixelCollection_SetArea = Q.dk, r._PixelCollection_ToByteArray = Q.ek, r._PixelCollection_ToShortArray = Q.fk, r._Quantum_Depth_Get = Q.gk, r._Quantum_Max_Get = Q.hk, r._ResourceLimits_Area_Get = Q.ik, r._ResourceLimits_Area_Set = Q.jk, r._ResourceLimits_Disk_Get = Q.kk, r._ResourceLimits_Disk_Set = Q.lk, r._ResourceLimits_Height_Get = Q.mk, r._ResourceLimits_Height_Set = Q.nk, r._ResourceLimits_ListLength_Get = Q.ok, r._ResourceLimits_ListLength_Set = Q.pk, r._ResourceLimits_MaxMemoryRequest_Get = Q.qk, r._ResourceLimits_MaxMemoryRequest_Set = Q.rk, r._ResourceLimits_MaxProfileSize_Get = Q.sk, r._ResourceLimits_MaxProfileSize_Set = Q.tk, r._ResourceLimits_Memory_Get = Q.uk, r._ResourceLimits_Memory_Set = Q.vk, r._ResourceLimits_Thread_Get = Q.wk, r._ResourceLimits_Thread_Set = Q.xk, r._ResourceLimits_Throttle_Get = Q.yk, r._ResourceLimits_Throttle_Set = Q.zk, r._ResourceLimits_Time_Get = Q.Ak, r._ResourceLimits_Time_Set = Q.Bk, r._ResourceLimits_Width_Get = Q.Ck, r._ResourceLimits_Width_Set = Q.Dk, r._ResourceLimits_LimitMemory = Q.Ek, r._ResourceLimits_TrimMemory = Q.Fk, r._DrawingSettings_Create = Q.Gk, r._DrawingSettings_Dispose = Q.Hk, r._DrawingSettings_BorderColor_Get = Q.Ik, r._DrawingSettings_BorderColor_Set = Q.Jk, r._DrawingSettings_FillColor_Get = Q.Kk, r._DrawingSettings_FillColor_Set = Q.Lk, r._DrawingSettings_FillRule_Get = Q.Mk, r._DrawingSettings_FillRule_Set = Q.Nk, r._DrawingSettings_Font_Get = Q.Ok, r._DrawingSettings_Font_Set = Q.Pk, r._DrawingSettings_FontFamily_Get = Q.Qk, r._DrawingSettings_FontFamily_Set = Q.Rk, r._DrawingSettings_FontPointsize_Get = Q.Sk, r._DrawingSettings_FontPointsize_Set = Q.Tk, r._DrawingSettings_FontStyle_Get = Q.Uk, r._DrawingSettings_FontStyle_Set = Q.Vk, r._DrawingSettings_FontWeight_Get = Q.Wk, r._DrawingSettings_FontWeight_Set = Q.Xk, r._DrawingSettings_StrokeAntiAlias_Get = Q.Yk, r._DrawingSettings_StrokeAntiAlias_Set = Q.Zk, r._DrawingSettings_StrokeColor_Get = Q._k, r._DrawingSettings_StrokeColor_Set = Q.$k, r._DrawingSettings_StrokeDashOffset_Get = Q.al, r._DrawingSettings_StrokeDashOffset_Set = Q.bl, r._DrawingSettings_StrokeLineCap_Get = Q.cl, r._DrawingSettings_StrokeLineCap_Set = Q.dl, r._DrawingSettings_StrokeLineJoin_Get = Q.el, r._DrawingSettings_StrokeLineJoin_Set = Q.fl, r._DrawingSettings_StrokeMiterLimit_Get = Q.gl, r._DrawingSettings_StrokeMiterLimit_Set = Q.hl, r._DrawingSettings_StrokeWidth_Get = Q.il, r._DrawingSettings_StrokeWidth_Set = Q.jl, r._DrawingSettings_TextAntiAlias_Get = Q.kl, r._DrawingSettings_TextAntiAlias_Set = Q.ll, r._DrawingSettings_TextDirection_Get = Q.ml, r._DrawingSettings_TextDirection_Set = Q.nl, r._DrawingSettings_TextEncoding_Get = Q.ol, r._DrawingSettings_TextEncoding_Set = Q.pl, r._DrawingSettings_TextGravity_Get = Q.ql, r._DrawingSettings_TextGravity_Set = Q.rl, r._DrawingSettings_TextInterlineSpacing_Get = Q.sl, r._DrawingSettings_TextInterlineSpacing_Set = Q.tl, r._DrawingSettings_TextInterwordSpacing_Get = Q.ul, r._DrawingSettings_TextInterwordSpacing_Set = Q.vl, r._DrawingSettings_TextKerning_Get = Q.wl, r._DrawingSettings_TextKerning_Set = Q.xl, r._DrawingSettings_TextUnderColor_Get = Q.yl, r._DrawingSettings_TextUnderColor_Set = Q.zl, r._DrawingSettings_SetAffine = Q.Al, r._DrawingSettings_SetFillPattern = Q.Bl, r._DrawingSettings_SetStrokeDashArray = Q.Cl, r._DrawingSettings_SetStrokePattern = Q.Dl, r._DrawingSettings_SetText = Q.El, r._MagickSettings_Create = Q.Fl, r._MagickSettings_Dispose = Q.Gl, r._MagickSettings_AntiAlias_Get = Q.Hl, r._MagickSettings_AntiAlias_Set = Q.Il, r._MagickSettings_BackgroundColor_Get = Q.Jl, r._MagickSettings_BackgroundColor_Set = Q.Kl, r._MagickSettings_ColorSpace_Get = Q.Ll, r._MagickSettings_ColorSpace_Set = Q.Ml, r._MagickSettings_ColorType_Get = Q.Nl, r._MagickSettings_ColorType_Set = Q.Ol, r._MagickSettings_Compression_Get = Q.Pl, r._MagickSettings_Compression_Set = Q.Ql, r._MagickSettings_Debug_Get = Q.Rl, r._MagickSettings_Debug_Set = Q.Sl, r._MagickSettings_Density_Get = Q.Tl, r._MagickSettings_Density_Set = Q.Ul, r._MagickSettings_Depth_Get = Q.Vl, r._MagickSettings_Depth_Set = Q.Wl, r._MagickSettings_Endian_Get = Q.Xl, r._MagickSettings_Endian_Set = Q.Yl, r._MagickSettings_Extract_Get = Q.Zl, r._MagickSettings_Extract_Set = Q._l, r._MagickSettings_Format_Get = Q.$l, r._MagickSettings_Format_Set = Q.am, r._MagickSettings_FontPointsize_Get = Q.bm, r._MagickSettings_FontPointsize_Set = Q.cm, r._MagickSettings_Interlace_Get = Q.dm, r._MagickSettings_Interlace_Set = Q.em, r._MagickSettings_Monochrome_Get = Q.fm, r._MagickSettings_Monochrome_Set = Q.gm, r._MagickSettings_Verbose_Get = Q.hm, r._MagickSettings_Verbose_Set = Q.im, r._MagickSettings_SetColorFuzz = Q.jm, r._MagickSettings_SetFileName = Q.km, r._MagickSettings_SetFont = Q.lm, r._MagickSettings_SetNumberScenes = Q.mm, r._MagickSettings_SetOption = Q.nm, r._MagickSettings_SetPage = Q.om, r._MagickSettings_SetPing = Q.pm, r._MagickSettings_SetQuality = Q.qm, r._MagickSettings_SetScenes = Q.rm, r._MagickSettings_SetScene = Q.sm, r._MagickSettings_SetSize = Q.tm, r._MontageSettings_Create = Q.um, r._MontageSettings_Dispose = Q.vm, r._MontageSettings_SetBackgroundColor = Q.wm, r._MontageSettings_SetBorderColor = Q.xm, r._MontageSettings_SetBorderWidth = Q.ym, r._MontageSettings_SetFillColor = Q.zm, r._MontageSettings_SetFont = Q.Am, r._MontageSettings_SetFontPointsize = Q.Bm, r._MontageSettings_SetFrameGeometry = Q.Cm, r._MontageSettings_SetGeometry = Q.Dm, r._MontageSettings_SetGravity = Q.Em, r._MontageSettings_SetShadow = Q.Fm, r._MontageSettings_SetStrokeColor = Q.Gm, r._MontageSettings_SetTextureFileName = Q.Hm, r._MontageSettings_SetTileGeometry = Q.Im, r._MontageSettings_SetTitle = Q.Jm, r._QuantizeSettings_SetColors = Q.Km, r._QuantizeSettings_SetColorSpace = Q.Lm, r._QuantizeSettings_SetDitherMethod = Q.Mm, r._QuantizeSettings_SetMeasureErrors = Q.Nm, r._QuantizeSettings_SetTreeDepth = Q.Om, r._ChannelMoments_Centroid_Get = Q.Pm, r._ChannelMoments_EllipseAngle_Get = Q.Qm, r._ChannelMoments_EllipseAxis_Get = Q.Rm, r._ChannelMoments_EllipseEccentricity_Get = Q.Sm, r._ChannelMoments_EllipseIntensity_Get = Q.Tm, r._ChannelMoments_GetHuInvariants = Q.Um, r._ChannelPerceptualHash_GetHuPhash = Q.Vm, r._ChannelStatistics_Depth_Get = Q.Wm, r._ChannelStatistics_Entropy_Get = Q.Xm, r._ChannelStatistics_Kurtosis_Get = Q.Ym, r._ChannelStatistics_Maximum_Get = Q.Zm, r._ChannelStatistics_Mean_Get = Q._m, r._ChannelStatistics_Minimum_Get = Q.$m, r._ChannelStatistics_Skewness_Get = Q.an, r._ChannelStatistics_StandardDeviation_Get = Q.bn, r._Moments_DisposeList = Q.cn, r._Moments_GetInstance = Q.dn, r._PerceptualHash_DisposeList = Q.en, r._PerceptualHash_GetInstance = Q.fn, r._Statistics_DisposeList = Q.gn, r._Statistics_GetInstance = Q.hn, r._ConnectedComponent_DisposeList = Q.jn, r._ConnectedComponent_GetArea = Q.kn, r._ConnectedComponent_GetCentroid = Q.ln, r._ConnectedComponent_GetColor = Q.mn, r._ConnectedComponent_GetHeight = Q.nn, r._ConnectedComponent_GetId = Q.on, r._ConnectedComponent_GetWidth = Q.pn, r._ConnectedComponent_GetX = Q.qn, r._ConnectedComponent_GetY = Q.rn, r._ConnectedComponent_GetInstance = Q.sn, r._MagickGeometry_Create = Q.tn, r._MagickGeometry_Dispose = Q.un, r._MagickGeometry_X_Get = Q.vn, r._MagickGeometry_Y_Get = Q.wn, r._MagickGeometry_Width_Get = Q.xn, r._MagickGeometry_Height_Get = Q.yn, r._MagickGeometry_Initialize = Q.zn, r._MagickRectangle_Dispose = Q.An, r._MagickRectangle_X_Get = Q.Bn, r._MagickRectangle_X_Set = Q.Cn, r._MagickRectangle_Y_Get = Q.Dn, r._MagickRectangle_Y_Set = Q.En, r._MagickRectangle_Width_Get = Q.Fn, r._MagickRectangle_Width_Set = Q.Gn, r._MagickRectangle_Height_Get = Q.Hn, r._MagickRectangle_Height_Set = Q.In, r._MagickRectangle_FromPageSize = Q.Jn, r._OffsetInfo_Create = Q.Kn, r._OffsetInfo_Dispose = Q.Ln, r._OffsetInfo_SetX = Q.Mn, r._OffsetInfo_SetY = Q.Nn, r._PointInfo_X_Get = Q.On, r._PointInfo_Y_Get = Q.Pn, r._PointInfoCollection_Create = Q.Qn, r._PointInfoCollection_Dispose = Q.Rn, r._PointInfoCollection_GetX = Q.Sn, r._PointInfoCollection_GetY = Q.Tn, r._PointInfoCollection_Set = Q.Un, r._PrimaryInfo_Dispose = Q.Vn, r._PrimaryInfo_X_Get = Q.Wn, r._PrimaryInfo_X_Set = Q.Xn, r._PrimaryInfo_Y_Get = Q.Yn, r._PrimaryInfo_Y_Set = Q.Zn, r._PrimaryInfo_Z_Get = Q._n, r._PrimaryInfo_Z_Set = Q.$n, r._StringInfo_Length_Get = Q.ao, r._StringInfo_Datum_Get = Q.bo, r._TypeMetric_Dispose = Q.co, r._TypeMetric_Ascent_Get = Q.eo, r._TypeMetric_Descent_Get = Q.fo, r._TypeMetric_MaxHorizontalAdvance_Get = Q.go, r._TypeMetric_TextHeight_Get = Q.ho, r._TypeMetric_TextWidth_Get = Q.io, r._TypeMetric_UnderlinePosition_Get = Q.jo, r._TypeMetric_UnderlineThickness_Get = Q.ko;
		var Mi = Q.lo, $ = Q.mo, Ni = Q.no, Pi = Q.oo, Fi = Q.po, Ii = Q.qo, Li = Q.ro, Ri = Q.so, zi = Q.to;
		function Bi(e, t, n, r) {
			var i = N();
			try {
				F(e)(t, n, r);
			} catch (e) {
				if (M(i), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Vi(e, t, n, r) {
			var i = N();
			try {
				return F(e)(t, n, r);
			} catch (e) {
				if (M(i), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Hi(e, t, n) {
			var r = N();
			try {
				return F(e)(t, n);
			} catch (e) {
				if (M(r), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Ui(e, t) {
			var n = N();
			try {
				return F(e)(t);
			} catch (e) {
				if (M(n), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Wi(e, t) {
			var n = N();
			try {
				F(e)(t);
			} catch (e) {
				if (M(n), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Gi(e, t, n) {
			var r = N();
			try {
				F(e)(t, n);
			} catch (e) {
				if (M(r), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Ki(e, t, n, r, i) {
			var a = N();
			try {
				F(e)(t, n, r, i);
			} catch (e) {
				if (M(a), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function qi(e, t, n, r, i) {
			var a = N();
			try {
				return F(e)(t, n, r, i);
			} catch (e) {
				if (M(a), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Ji(e, t, n, r) {
			var i = N();
			try {
				return F(e)(t, n, r);
			} catch (e) {
				if (M(i), e !== e + 0) throw e;
				return $(1, 0), 0n;
			}
		}
		function Yi(e, t) {
			var n = N();
			try {
				return F(e)(t);
			} catch (e) {
				if (M(n), e !== e + 0) throw e;
				return $(1, 0), 0n;
			}
		}
		function Xi(e, t, n, r, i, a, o, s, c) {
			var l = N();
			try {
				return F(e)(t, n, r, i, a, o, s, c);
			} catch (e) {
				if (M(l), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Zi(e, t, n, r, i, a, o) {
			var s = N();
			try {
				return F(e)(t, n, r, i, a, o);
			} catch (e) {
				if (M(s), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function Qi(e, t, n, r, i) {
			var a = N();
			try {
				return F(e)(t, n, r, i);
			} catch (e) {
				if (M(a), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function $i(e) {
			var t = N();
			try {
				return F(e)();
			} catch (e) {
				if (M(t), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ea(e, t, n) {
			var r = N();
			try {
				return F(e)(t, n);
			} catch (e) {
				if (M(r), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ta(e, t, n) {
			var r = N();
			try {
				F(e)(t, n);
			} catch (e) {
				if (M(r), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function na(e, t, n, r, i, a) {
			var o = N();
			try {
				return F(e)(t, n, r, i, a);
			} catch (e) {
				if (M(o), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ra(e, t, n) {
			var r = N();
			try {
				return F(e)(t, n);
			} catch (e) {
				if (M(r), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ia(e) {
			var t = N();
			try {
				F(e)();
			} catch (e) {
				if (M(t), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function aa(e, t, n, r, i, a) {
			var o = N();
			try {
				F(e)(t, n, r, i, a);
			} catch (e) {
				if (M(o), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function oa(e, t, n, r, i, a, o, s) {
			var c = N();
			try {
				return F(e)(t, n, r, i, a, o, s);
			} catch (e) {
				if (M(c), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function sa(e, t, n, r, i, a, o, s, c, l) {
			var u = N();
			try {
				return F(e)(t, n, r, i, a, o, s, c, l);
			} catch (e) {
				if (M(u), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ca(e, t, n, r) {
			var i = N();
			try {
				F(e)(t, n, r);
			} catch (e) {
				if (M(i), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function la(e, t, n, r, i, a, o, s, c, l, u) {
			var d = N();
			try {
				F(e)(t, n, r, i, a, o, s, c, l, u);
			} catch (e) {
				if (M(d), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ua(e, t, n, r, i, a, o, s, c, l, u) {
			var d = N();
			try {
				return F(e)(t, n, r, i, a, o, s, c, l, u);
			} catch (e) {
				if (M(d), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function da(e, t, n, r, i, a, o, s, c, l) {
			var u = N();
			try {
				F(e)(t, n, r, i, a, o, s, c, l);
			} catch (e) {
				if (M(u), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function fa(e, t, n, r, i, a, o) {
			var s = N();
			try {
				F(e)(t, n, r, i, a, o);
			} catch (e) {
				if (M(s), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function pa(e, t, n, r, i, a, o, s) {
			var c = N();
			try {
				F(e)(t, n, r, i, a, o, s);
			} catch (e) {
				if (M(c), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ma(e, t, n, r, i, a, o, s, c, l, u, d) {
			var f = N();
			try {
				return F(e)(t, n, r, i, a, o, s, c, l, u, d);
			} catch (e) {
				if (M(f), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ha(e, t, n, r, i, a) {
			var o = N();
			try {
				return F(e)(t, n, r, i, a);
			} catch (e) {
				if (M(o), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ga(e, t) {
			var n = N();
			try {
				return F(e)(t);
			} catch (e) {
				if (M(n), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function _a(e, t, n, r, i, a, o, s, c) {
			var l = N();
			try {
				F(e)(t, n, r, i, a, o, s, c);
			} catch (e) {
				if (M(l), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function va(e, t, n, r, i, a, o, s, c, l, u, d) {
			var f = N();
			try {
				F(e)(t, n, r, i, a, o, s, c, l, u, d);
			} catch (e) {
				if (M(f), e !== e + 0) throw e;
				$(1, 0);
			}
		}
		function ya(e) {
			e = Object.assign({}, e);
			var t = (e) => (t) => e(t) >>> 0;
			return e.ib = t(e.ib), e.Zj = t(e.Zj), e.lo = ((e) => (t, n) => e(t, n) >>> 0)(e.lo), e._emscripten_stack_alloc = t(e._emscripten_stack_alloc), e.po = ((e) => () => e() >>> 0)(e.po), e.to = t(e.to), e;
		}
		function ba() {
			if (E > 0) {
				D = ba;
				return;
			}
			if (T(), E > 0) {
				D = ba;
				return;
			}
			function e() {
				r.calledRun = !0, !ne && (se(), i(r), r.onRuntimeInitialized?.(), ce());
			}
			r.setStatus ? (r.setStatus("Running..."), setTimeout(() => {
				setTimeout(() => r.setStatus(""), 1), e();
			}, 1)) : e();
		}
		function xa() {
			if (r.preInit) for (typeof r.preInit == "function" && (r.preInit = [r.preInit]); r.preInit.length > 0;) r.preInit.shift()();
		}
		return xa(), ba(), n = o, n;
	});
})(), Je = class {
	constructor(e) {
		if (e instanceof URL) {
			if (e.protocol !== "http:" && e.protocol !== "https:") throw new C("Only http/https protocol is supported");
			this.locateFile = () => e.href;
		} else e instanceof WebAssembly.Module ? this.instantiateWasm = (t, n) => {
			n(new WebAssembly.Instance(e, t));
		} : this.wasmBinary = e;
	}
	wasmBinary;
	instantiateWasm;
	locateFile;
}, V = class {
	loader;
	api;
	constructor() {
		this.loader = (e, t) => new Promise((n, r) => {
			if (this.api !== void 0) {
				n();
				return;
			}
			qe(new Je(e)).then((e) => {
				try {
					this.writeConfigurationFiles(e, t), ce(e, "MAGICK_CONFIGURE_PATH", (t) => {
						ce(e, "/xml", (r) => {
							e._Environment_SetEnv(t, r), e._Environment_Initialize(), this.api = e, n();
						});
					});
				} catch (e) {
					r(e);
				}
			});
		});
	}
	async _initialize(e, t) {
		await this.loader(e, t);
	}
	static get _api() {
		if (!Ye.api) throw new C("`await initializeImageMagick` should be called to initialize the library");
		return Ye.api;
	}
	static set _api(e) {
		Ye.api = e;
	}
	static read(t, n, r, i) {
		return B._create((a) => {
			let o = i;
			if (typeof t != "string" && !e(t)) typeof n == "number" && typeof r == "number" && a.read(t, n, r);
			else if (typeof n != "number" && typeof r != "number") {
				o = r;
				let e;
				n instanceof I ? e = n : typeof n == "string" ? (e = new I(), e.format = n) : o = n, a.read(t, e);
			}
			return o(a);
		});
	}
	static readCollection(e, t, n) {
		return Fe.use((r) => {
			let i = n, a;
			return t instanceof I ? a = t : typeof t == "string" ? (a = new I(), a.format = t) : i = t, r.read(e, a), i(r);
		});
	}
	static readFromCanvas(e, t, n) {
		return B._create((r) => (r.readFromCanvas(e, n), t(r)));
	}
	writeConfigurationFiles(e, t) {
		e.FS.analyzePath("/xml").exists || e.FS.mkdir("/xml");
		for (let n of t.all()) {
			let t = e.FS.open(`/xml/${n.fileName}`, "w"), r = new TextEncoder().encode(n.data);
			e.FS.write(t, r, 0, r.length), e.FS.close(t);
		}
	}
}, Ye = new V();
async function Xe(e, t) {
	await Ye._initialize(e, t ?? r.default);
}
//#endregion
//#region src/events/progress-event.ts
var Ze = class {
	constructor(e, t, n) {
		this.origin = e, this.progress = new L((t + 1) / (n * 100));
	}
	origin;
	progress;
	cancel = !1;
}, H = class e {
	static _logDelegate = 0;
	static _onLog;
	static _progressDelegate = 0;
	static _images = {};
	static setLogDelegate(t) {
		e._logDelegate === 0 && t !== void 0 && (e._logDelegate = V._api.addFunction(e.logDelegate, "vii")), V._api._Magick_SetLogDelegate(t === void 0 ? 0 : e._logDelegate), e._onLog = t;
	}
	static setProgressDelegate(t) {
		e._progressDelegate === 0 && (this._progressDelegate = V._api.addFunction(e.progressDelegate, "iijji")), this._images[t._instance] = t, V._api._MagickImage_SetClientData(t._instance, t._instance), V._api._MagickImage_SetProgressDelegate(t._instance, e._progressDelegate);
	}
	static removeProgressDelegate(t) {
		V._api._MagickImage_SetClientData(t._instance, 0), V._api._MagickImage_SetProgressDelegate(t._instance, 0), delete e._images[t._instance];
	}
	static logDelegate(t, n) {
		if (e._onLog === void 0) return;
		let r = T(n, "");
		e._onLog(new p(t, r));
	}
	static progressDelegate(t, n, r, i) {
		let a = e._images[i];
		if (a === void 0 || a.onProgress === void 0) return 1;
		let o = Number(n), s = Number(r), c = new Ze(T(t), o, s);
		return a.onProgress(c), +!c.cancel;
	}
}, Qe = class e {
	static _allFormats;
	constructor(e, t, n, r, i, a, o) {
		this.format = e, this.description = t, this.mimeType = n, this.moduleFormat = r, this.supportsMultipleFrames = i, this.supportsReading = a, this.supportsWriting = o;
	}
	description;
	format;
	mimeType;
	moduleFormat;
	supportsMultipleFrames;
	supportsReading;
	supportsWriting;
	static get all() {
		return e._allFormats === void 0 && (e._allFormats = e.loadFormats()), e._allFormats;
	}
	static loadFormats() {
		return A.usePointer((t) => _e.use((n) => {
			let r = V._api._MagickFormatInfo_CreateList(n.ptr, t), i = n.value;
			try {
				let n = Array(i), a = Object.values(Ee);
				for (let o = 0; o < i; o++) {
					let i = V._api._MagickFormatInfo_GetInfo(r, o, t), s = T(V._api._MagickFormatInfo_Format_Get(i)), c = e.convertFormat(s, a), l = T(V._api._MagickFormatInfo_Description_Get(i), ""), u = T(V._api._MagickFormatInfo_MimeType_Get(i)), d = T(V._api._MagickFormatInfo_Module_Get(i));
					n[o] = new e(c, l, u, e.convertFormat(d, a), V._api._MagickFormatInfo_SupportsMultipleFrames_Get(i) == 1, V._api._MagickFormatInfo_SupportsReading_Get(i) == 1, V._api._MagickFormatInfo_SupportsWriting_Get(i) == 1);
				}
				return n;
			} finally {
				V._api._MagickFormatInfo_DisposeList(r, i);
			}
		}));
	}
	static convertFormat(e, t) {
		return e === null ? Ee.Unknown : t.includes(e) ? e : Ee.Unknown;
	}
}, U = {
	None: 0,
	Accelerate: 1,
	Annotate: 2,
	Blob: 4,
	Cache: 8,
	Coder: 16,
	Configure: 32,
	Deprecate: 64,
	Draw: 128,
	Exception: 256,
	Image: 512,
	Locale: 1024,
	Module: 2048,
	Pixel: 4096,
	Policy: 8192,
	Resource: 16384,
	Trace: 32768,
	Transform: 65536,
	User: 131072,
	Wand: 262144,
	Detailed: 2147450879,
	get All() {
		return this.Detailed | this.Trace;
	}
}, $e = class e {
	static get delegates() {
		return T(V._api._Magick_Delegates_Get(), "Unknown");
	}
	static get features() {
		return T(V._api._Magick_Features_Get(), " ").slice(0, -1);
	}
	static get imageMagickVersion() {
		return T(V._api._Magick_ImageMagickVersion_Get(), "Unknown");
	}
	static get supportedFormats() {
		return Qe.all;
	}
	static onLog;
	static addFont(e, t) {
		let n = V._api.FS;
		n.analyzePath("/fonts").exists || n.mkdir("/fonts");
		let r = n.open(`/fonts/${e}`, "w");
		n.write(r, t, 0, t.length), n.close(r);
	}
	static resetRandomSeed = () => V._api._Magick_ResetRandomSeed();
	static setRandomSeed = (e) => V._api._Magick_SetRandomSeed(e);
	static setLogEvents(t) {
		let n = t == U.None ? void 0 : e.logDelegate;
		H.setLogDelegate(n), E(e.getEventTypeString(t), (e) => V._api._Magick_SetLogEvents(e));
	}
	static _getFontFileName(e) {
		let t = `/fonts/${e}`;
		if (!V._api.FS.analyzePath(t).exists) throw `Unable to find a font with the name '${e}', register it with the addFont method of the Magick class.`;
		return t;
	}
	static getEventTypeString(e) {
		if (e == U.All) return "All,Trace";
		if (e == U.Detailed) return "All";
		switch (e) {
			case U.Accelerate: return "Accelerate";
			case U.Annotate: return "Annotate";
			case U.Blob: return "Blob";
			case U.Cache: return "Cache";
			case U.Coder: return "Coder";
			case U.Configure: return "Configure";
			case U.Deprecate: return "Deprecate";
			case U.Draw: return "Draw";
			case U.Exception: return "Exception";
			case U.Image: return "Image";
			case U.Locale: return "Locale";
			case U.Module: return "Module";
			case U.Pixel: return "Pixel";
			case U.Policy: return "Policy";
			case U.Resource: return "Resource";
			case U.Trace: return "Trace";
			case U.Transform: return "Transform";
			case U.User: return "User";
			case U.Wand: return "Wand";
			case U.None:
			default: return "None";
		}
	}
	static logDelegate(t) {
		e.onLog !== void 0 && e.onLog(t);
	}
}, et = class {
	_font;
	constructor(e) {
		this._font = e;
	}
	get font() {
		return this._font;
	}
	draw(e) {
		let t = $e._getFontFileName(this._font);
		e.font(t);
	}
}, tt = class {
	_gravity;
	constructor(e) {
		this._gravity = e;
	}
	get gravity() {
		return this._gravity;
	}
	draw(e) {
		e.gravity(this._gravity);
	}
}, nt = class {
	_startX;
	_startY;
	_endX;
	_endY;
	constructor(e, t, n, r) {
		this._startX = e, this._startY = t, this._endX = n, this._endY = r;
	}
	get startX() {
		return this._startX;
	}
	get startY() {
		return this._startY;
	}
	get endX() {
		return this._endX;
	}
	get endY() {
		return this._endY;
	}
	draw(e) {
		e.line(this._startX, this._startY, this._endX, this._endY);
	}
}, rt = class {
	_paths = [];
	constructor(e) {
		this._paths = e;
	}
	draw(e) {
		e.pathStart();
		for (let t of this._paths) t.draw(e);
		e.pathFinish();
	}
}, W = class {
	_x;
	_y;
	constructor(e, t) {
		this._x = e, this._y = t;
	}
	get x() {
		return this._x;
	}
	get y() {
		return this._y;
	}
	draw(e) {
		e.point(this._x, this._y);
	}
}, it = class {
	_upperLeftX;
	_upperLeftY;
	_lowerRightX;
	_lowerRightY;
	constructor(e, t, n, r) {
		this._upperLeftX = e, this._upperLeftY = t, this._lowerRightX = n, this._lowerRightY = r;
	}
	get upperLeftX() {
		return this._upperLeftX;
	}
	get upperLeftY() {
		return this._upperLeftY;
	}
	get lowerRightX() {
		return this._lowerRightX;
	}
	get lowerRightY() {
		return this._lowerRightY;
	}
	draw(e) {
		e.rectangle(this._upperLeftX, this._upperLeftY, this._lowerRightX, this._lowerRightY);
	}
}, G = class {
	_upperLeftX;
	_upperLeftY;
	_lowerRightX;
	_lowerRightY;
	_cornerWidth;
	_cornerHeight;
	constructor(e, t, n, r, i, a) {
		this._upperLeftX = e, this._upperLeftY = t, this._lowerRightX = n, this._lowerRightY = r, this._cornerWidth = i, this._cornerHeight = a;
	}
	get upperLeftX() {
		return this._upperLeftX;
	}
	get upperLeftY() {
		return this._upperLeftY;
	}
	get lowerRightX() {
		return this._lowerRightX;
	}
	get lowerRightY() {
		return this._lowerRightY;
	}
	get cornerWidth() {
		return this._cornerWidth;
	}
	get cornerHeight() {
		return this._cornerHeight;
	}
	draw(e) {
		e.roundRectangle(this._upperLeftX, this._upperLeftY, this._lowerRightX, this._lowerRightY, this._cornerWidth, this._cornerHeight);
	}
}, at = class {
	_color;
	constructor(e) {
		this._color = e;
	}
	get color() {
		return this._color;
	}
	draw(e) {
		e.strokeColor(this._color);
	}
}, ot = class {
	_dash = [];
	constructor(e) {
		this._dash = [...e];
	}
	get dash() {
		return this._dash;
	}
	draw(e) {
		e.strokeDashArray(this._dash);
	}
}, st = class {
	_offset;
	constructor(e) {
		this._offset = e;
	}
	get offset() {
		return this._offset;
	}
	draw(e) {
		e.strokeDashOffset(this._offset);
	}
}, ct = class {
	_width;
	constructor(e) {
		this._width = e;
	}
	get width() {
		return this._width;
	}
	draw(e) {
		e.strokeWidth(this._width);
	}
}, lt = class {
	_alignment;
	constructor(e) {
		this._alignment = e;
	}
	get alignment() {
		return this._alignment;
	}
	draw(e) {
		e.textAlignment(this._alignment);
	}
}, ut = class e {
	_isEnabled;
	constructor(e) {
		this._isEnabled = e;
	}
	static get disabled() {
		return new e(!1);
	}
	static get enabled() {
		return new e(!0);
	}
	get isEnabled() {
		return this._isEnabled;
	}
	draw(e) {
		e.textAntialias(this._isEnabled);
	}
}, dt = class {
	_decoration;
	constructor(e) {
		this._decoration = e;
	}
	get decoration() {
		return this._decoration;
	}
	draw(e) {
		e.textDecoration(this._decoration);
	}
}, ft = class {
	_spacing;
	constructor(e) {
		this._spacing = e;
	}
	get spacing() {
		return this._spacing;
	}
	draw(e) {
		e.textInterlineSpacing(this._spacing);
	}
}, pt = class {
	_spacing;
	constructor(e) {
		this._spacing = e;
	}
	get spacing() {
		return this._spacing;
	}
	draw(e) {
		e.textInterwordspacing(this._spacing);
	}
}, K = class {
	_kerning;
	constructor(e) {
		this._kerning = e;
	}
	get kerning() {
		return this._kerning;
	}
	draw(e) {
		e.textKerning(this._kerning);
	}
}, mt = class {
	_color;
	constructor(e) {
		this._color = e;
	}
	get color() {
		return this._color;
	}
	draw(e) {
		e.textUnderColor(this._color);
	}
}, ht = class {
	_x;
	_y;
	_value;
	constructor(e, t, n) {
		this._x = e, this._y = t, this._value = n;
	}
	get x() {
		return this._x;
	}
	get y() {
		return this._y;
	}
	get value() {
		return this._value;
	}
	draw(e) {
		e.text(this._x, this._y, this._value);
	}
}, gt = class {
	static get None() {
		return new D(0, 0, 0, 0);
	}
	static get Transparent() {
		return new D(0, 0, 0, 0);
	}
	static get AliceBlue() {
		return new D(240, 248, 255, 255);
	}
	static get AntiqueWhite() {
		return new D(250, 235, 215, 255);
	}
	static get Aqua() {
		return new D(0, 255, 255, 255);
	}
	static get Aquamarine() {
		return new D(127, 255, 212, 255);
	}
	static get Azure() {
		return new D(240, 255, 255, 255);
	}
	static get Beige() {
		return new D(245, 245, 220, 255);
	}
	static get Bisque() {
		return new D(255, 228, 196, 255);
	}
	static get Black() {
		return new D(0, 0, 0, 255);
	}
	static get BlanchedAlmond() {
		return new D(255, 235, 205, 255);
	}
	static get Blue() {
		return new D(0, 0, 255, 255);
	}
	static get BlueViolet() {
		return new D(138, 43, 226, 255);
	}
	static get Brown() {
		return new D(165, 42, 42, 255);
	}
	static get BurlyWood() {
		return new D(222, 184, 135, 255);
	}
	static get CadetBlue() {
		return new D(95, 158, 160, 255);
	}
	static get Chartreuse() {
		return new D(127, 255, 0, 255);
	}
	static get Chocolate() {
		return new D(210, 105, 30, 255);
	}
	static get Coral() {
		return new D(255, 127, 80, 255);
	}
	static get CornflowerBlue() {
		return new D(100, 149, 237, 255);
	}
	static get Cornsilk() {
		return new D(255, 248, 220, 255);
	}
	static get Crimson() {
		return new D(220, 20, 60, 255);
	}
	static get Cyan() {
		return new D(0, 255, 255, 255);
	}
	static get DarkBlue() {
		return new D(0, 0, 139, 255);
	}
	static get DarkCyan() {
		return new D(0, 139, 139, 255);
	}
	static get DarkGoldenrod() {
		return new D(184, 134, 11, 255);
	}
	static get DarkGray() {
		return new D(169, 169, 169, 255);
	}
	static get DarkGreen() {
		return new D(0, 100, 0, 255);
	}
	static get DarkKhaki() {
		return new D(189, 183, 107, 255);
	}
	static get DarkMagenta() {
		return new D(139, 0, 139, 255);
	}
	static get DarkOliveGreen() {
		return new D(85, 107, 47, 255);
	}
	static get DarkOrange() {
		return new D(255, 140, 0, 255);
	}
	static get DarkOrchid() {
		return new D(153, 50, 204, 255);
	}
	static get DarkRed() {
		return new D(139, 0, 0, 255);
	}
	static get DarkSalmon() {
		return new D(233, 150, 122, 255);
	}
	static get DarkSeaGreen() {
		return new D(143, 188, 143, 255);
	}
	static get DarkSlateBlue() {
		return new D(72, 61, 139, 255);
	}
	static get DarkSlateGray() {
		return new D(47, 79, 79, 255);
	}
	static get DarkTurquoise() {
		return new D(0, 206, 209, 255);
	}
	static get DarkViolet() {
		return new D(148, 0, 211, 255);
	}
	static get DeepPink() {
		return new D(255, 20, 147, 255);
	}
	static get DeepSkyBlue() {
		return new D(0, 191, 255, 255);
	}
	static get DimGray() {
		return new D(105, 105, 105, 255);
	}
	static get DodgerBlue() {
		return new D(30, 144, 255, 255);
	}
	static get Firebrick() {
		return new D(178, 34, 34, 255);
	}
	static get FloralWhite() {
		return new D(255, 250, 240, 255);
	}
	static get ForestGreen() {
		return new D(34, 139, 34, 255);
	}
	static get Fuchsia() {
		return new D(255, 0, 255, 255);
	}
	static get Gainsboro() {
		return new D(220, 220, 220, 255);
	}
	static get GhostWhite() {
		return new D(248, 248, 255, 255);
	}
	static get Gold() {
		return new D(255, 215, 0, 255);
	}
	static get Goldenrod() {
		return new D(218, 165, 32, 255);
	}
	static get Gray() {
		return new D(128, 128, 128, 255);
	}
	static get Green() {
		return new D(0, 128, 0, 255);
	}
	static get GreenYellow() {
		return new D(173, 255, 47, 255);
	}
	static get Honeydew() {
		return new D(240, 255, 240, 255);
	}
	static get HotPink() {
		return new D(255, 105, 180, 255);
	}
	static get IndianRed() {
		return new D(205, 92, 92, 255);
	}
	static get Indigo() {
		return new D(75, 0, 130, 255);
	}
	static get Ivory() {
		return new D(255, 255, 240, 255);
	}
	static get Khaki() {
		return new D(240, 230, 140, 255);
	}
	static get Lavender() {
		return new D(230, 230, 250, 255);
	}
	static get LavenderBlush() {
		return new D(255, 240, 245, 255);
	}
	static get LawnGreen() {
		return new D(124, 252, 0, 255);
	}
	static get LemonChiffon() {
		return new D(255, 250, 205, 255);
	}
	static get LightBlue() {
		return new D(173, 216, 230, 255);
	}
	static get LightCoral() {
		return new D(240, 128, 128, 255);
	}
	static get LightCyan() {
		return new D(224, 255, 255, 255);
	}
	static get LightGoldenrodYellow() {
		return new D(250, 250, 210, 255);
	}
	static get LightGreen() {
		return new D(144, 238, 144, 255);
	}
	static get LightGray() {
		return new D(211, 211, 211, 255);
	}
	static get LightPink() {
		return new D(255, 182, 193, 255);
	}
	static get LightSalmon() {
		return new D(255, 160, 122, 255);
	}
	static get LightSeaGreen() {
		return new D(32, 178, 170, 255);
	}
	static get LightSkyBlue() {
		return new D(135, 206, 250, 255);
	}
	static get LightSlateGray() {
		return new D(119, 136, 153, 255);
	}
	static get LightSteelBlue() {
		return new D(176, 196, 222, 255);
	}
	static get LightYellow() {
		return new D(255, 255, 224, 255);
	}
	static get Lime() {
		return new D(0, 255, 0, 255);
	}
	static get LimeGreen() {
		return new D(50, 205, 50, 255);
	}
	static get Linen() {
		return new D(250, 240, 230, 255);
	}
	static get Magenta() {
		return new D(255, 0, 255, 255);
	}
	static get Maroon() {
		return new D(128, 0, 0, 255);
	}
	static get MediumAquamarine() {
		return new D(102, 205, 170, 255);
	}
	static get MediumBlue() {
		return new D(0, 0, 205, 255);
	}
	static get MediumOrchid() {
		return new D(186, 85, 211, 255);
	}
	static get MediumPurple() {
		return new D(147, 112, 219, 255);
	}
	static get MediumSeaGreen() {
		return new D(60, 179, 113, 255);
	}
	static get MediumSlateBlue() {
		return new D(123, 104, 238, 255);
	}
	static get MediumSpringGreen() {
		return new D(0, 250, 154, 255);
	}
	static get MediumTurquoise() {
		return new D(72, 209, 204, 255);
	}
	static get MediumVioletRed() {
		return new D(199, 21, 133, 255);
	}
	static get MidnightBlue() {
		return new D(25, 25, 112, 255);
	}
	static get MintCream() {
		return new D(245, 255, 250, 255);
	}
	static get MistyRose() {
		return new D(255, 228, 225, 255);
	}
	static get Moccasin() {
		return new D(255, 228, 181, 255);
	}
	static get NavajoWhite() {
		return new D(255, 222, 173, 255);
	}
	static get Navy() {
		return new D(0, 0, 128, 255);
	}
	static get OldLace() {
		return new D(253, 245, 230, 255);
	}
	static get Olive() {
		return new D(128, 128, 0, 255);
	}
	static get OliveDrab() {
		return new D(107, 142, 35, 255);
	}
	static get Orange() {
		return new D(255, 165, 0, 255);
	}
	static get OrangeRed() {
		return new D(255, 69, 0, 255);
	}
	static get Orchid() {
		return new D(218, 112, 214, 255);
	}
	static get PaleGoldenrod() {
		return new D(238, 232, 170, 255);
	}
	static get PaleGreen() {
		return new D(152, 251, 152, 255);
	}
	static get PaleTurquoise() {
		return new D(175, 238, 238, 255);
	}
	static get PaleVioletRed() {
		return new D(219, 112, 147, 255);
	}
	static get PapayaWhip() {
		return new D(255, 239, 213, 255);
	}
	static get PeachPuff() {
		return new D(255, 218, 185, 255);
	}
	static get Peru() {
		return new D(205, 133, 63, 255);
	}
	static get Pink() {
		return new D(255, 192, 203, 255);
	}
	static get Plum() {
		return new D(221, 160, 221, 255);
	}
	static get PowderBlue() {
		return new D(176, 224, 230, 255);
	}
	static get Purple() {
		return new D(128, 0, 128, 255);
	}
	static get RebeccaPurple() {
		return new D(102, 51, 153, 255);
	}
	static get Red() {
		return new D(255, 0, 0, 255);
	}
	static get RosyBrown() {
		return new D(188, 143, 143, 255);
	}
	static get RoyalBlue() {
		return new D(65, 105, 225, 255);
	}
	static get SaddleBrown() {
		return new D(139, 69, 19, 255);
	}
	static get Salmon() {
		return new D(250, 128, 114, 255);
	}
	static get SandyBrown() {
		return new D(244, 164, 96, 255);
	}
	static get SeaGreen() {
		return new D(46, 139, 87, 255);
	}
	static get SeaShell() {
		return new D(255, 245, 238, 255);
	}
	static get Sienna() {
		return new D(160, 82, 45, 255);
	}
	static get Silver() {
		return new D(192, 192, 192, 255);
	}
	static get SkyBlue() {
		return new D(135, 206, 235, 255);
	}
	static get SlateBlue() {
		return new D(106, 90, 205, 255);
	}
	static get SlateGray() {
		return new D(112, 128, 144, 255);
	}
	static get Snow() {
		return new D(255, 250, 250, 255);
	}
	static get SpringGreen() {
		return new D(0, 255, 127, 255);
	}
	static get SteelBlue() {
		return new D(70, 130, 180, 255);
	}
	static get Tan() {
		return new D(210, 180, 140, 255);
	}
	static get Teal() {
		return new D(0, 128, 128, 255);
	}
	static get Thistle() {
		return new D(216, 191, 216, 255);
	}
	static get Tomato() {
		return new D(255, 99, 71, 255);
	}
	static get Turquoise() {
		return new D(64, 224, 208, 255);
	}
	static get Violet() {
		return new D(238, 130, 238, 255);
	}
	static get Wheat() {
		return new D(245, 222, 179, 255);
	}
	static get White() {
		return new D(255, 255, 255, 255);
	}
	static get WhiteSmoke() {
		return new D(245, 245, 245, 255);
	}
	static get Yellow() {
		return new D(255, 255, 0, 255);
	}
	static get YellowGreen() {
		return new D(154, 205, 50, 255);
	}
}, _t = class {
	_x;
	_y;
	constructor(e, t) {
		this._x = e, this._y = t;
	}
	get x() {
		return this._x;
	}
	get y() {
		return this._y;
	}
	draw(e) {
		e.pathLineToAbs(this._x, this._y);
	}
}, vt = class {
	_x;
	_y;
	constructor(e, t) {
		this._x = e, this._y = t;
	}
	get x() {
		return this._x;
	}
	get y() {
		return this._y;
	}
	draw(e) {
		e.pathLineToRel(this._x, this._y);
	}
}, yt = class {
	_x;
	_y;
	constructor(e, t) {
		this._x = e, this._y = t;
	}
	get x() {
		return this._x;
	}
	get y() {
		return this._y;
	}
	draw(e) {
		e.pathMoveToAbs(this._x, this._y);
	}
}, bt = class {
	_x;
	_y;
	constructor(e, t) {
		this._x = e, this._y = t;
	}
	get x() {
		return this._x;
	}
	get y() {
		return this._y;
	}
	draw(e) {
		e.pathMoveToRel(this._x, this._y);
	}
}, xt = class {
	_drawables;
	_paths = [];
	constructor(e) {
		this._drawables = e;
	}
	drawables() {
		return this._drawables === void 0 ? new St().path(this._paths) : this._drawables.path(this._paths);
	}
	lineToAbs(e, t) {
		return this._paths.push(new _t(e, t)), this;
	}
	lineToRel(e, t) {
		return this._paths.push(new vt(e, t)), this;
	}
	moveToAbs(e, t) {
		return this._paths.push(new yt(e, t)), this;
	}
	moveToRel(e, t) {
		return this._paths.push(new bt(e, t)), this;
	}
}, St = class {
	_drawables = [];
	affine(e = 1, t = 1, n = 0, r = 0, i = 0, a = 0) {
		return this._drawables.push(new o(e, t, n, r, i, a)), this;
	}
	color(e, t, n) {
		return this._drawables.push(new c(e, t, n)), this;
	}
	borderColor(e) {
		return this._drawables.push(new s(e)), this;
	}
	disableTextAntiAlias() {
		return this._drawables.push(ut.disabled), this;
	}
	draw(e) {
		return e.draw(this._drawables), this;
	}
	enableTextAntiAlias() {
		return this._drawables.push(ut.enabled), this;
	}
	fillColor(e) {
		return this._drawables.push(new l(e)), this;
	}
	fillOpacity(e) {
		return this._drawables.push(new u(e)), this;
	}
	fillRule(e) {
		return this._drawables.push(new d(e)), this;
	}
	font(e) {
		return this._drawables.push(new et(e)), this;
	}
	fontPointSize(e) {
		return this._drawables.push(new f(e)), this;
	}
	fontTypeMetrics(e, t = !1) {
		return B._create((n) => (n.read(gt.Transparent, 1, 1), Ce._use(n, (n) => (n.draw(this._drawables), n.fontTypeMetrics(e, t)))));
	}
	gravity(e) {
		return this._drawables.push(new tt(e)), this;
	}
	line(e, t, n, r) {
		return this._drawables.push(new nt(e, t, n, r)), this;
	}
	path(e) {
		return this._drawables.push(new rt(e)), this;
	}
	paths() {
		return new xt(this);
	}
	point(e, t) {
		return this._drawables.push(new W(e, t)), this;
	}
	rectangle(e, t, n, r) {
		return this._drawables.push(new it(e, t, n, r)), this;
	}
	roundRectangle(e, t, n, r, i, a) {
		return this._drawables.push(new G(e, t, n, r, i, a)), this;
	}
	strokeColor(e) {
		return this._drawables.push(new at(e)), this;
	}
	strokeDashArray(e) {
		return this._drawables.push(new ot(e)), this;
	}
	strokeDashOffset(e) {
		return this._drawables.push(new st(e)), this;
	}
	strokeWidth(e) {
		return this._drawables.push(new ct(e)), this;
	}
	text(e, t, n) {
		return this._drawables.push(new ht(e, t, n)), this;
	}
	textAlignment(e) {
		return this._drawables.push(new lt(e)), this;
	}
	textDecoration(e) {
		return this._drawables.push(new dt(e)), this;
	}
	textInterlineSpacing(e) {
		return this._drawables.push(new ft(e)), this;
	}
	textInterwordSpacing(e) {
		return this._drawables.push(new pt(e)), this;
	}
	textKerning(e) {
		return this._drawables.push(new K(e)), this;
	}
	textUnderColor(e) {
		return this._drawables.push(new mt(e)), this;
	}
}, Ct = {
	Undefined: 0,
	Kapur: 1,
	OTSU: 2,
	Triangle: 3
}, wt = {
	Undefined: 0,
	Direct: 1,
	Pseudo: 2
}, Tt = {
	Undefined: 0,
	Bilevel: 1,
	Grayscale: 2,
	GrayscaleAlpha: 3,
	Palette: 4,
	PaletteAlpha: 5,
	TrueColor: 6,
	TrueColorAlpha: 7,
	ColorSeparation: 8,
	ColorSeparationAlpha: 9,
	Optimize: 10,
	PaletteBilevelAlpha: 11
}, Et = {
	Undefined: 0,
	Add: 1,
	Conjugate: 2,
	Divide: 3,
	MagnitudePhase: 4,
	Multiply: 5,
	RealImaginary: 6,
	Subtract: 7
}, Dt = {
	Undefined: 0,
	B44A: 1,
	B44: 2,
	BZip: 3,
	DXT1: 4,
	DXT3: 5,
	DXT5: 6,
	Fax: 7,
	Group4: 8,
	JBIG1: 9,
	JBIG2: 10,
	JPEG2000: 11,
	JPEG: 12,
	LosslessJPEG: 13,
	LZMA: 14,
	LZW: 15,
	NoCompression: 16,
	Piz: 17,
	Pxr24: 18,
	RLE: 19,
	Zip: 20,
	ZipS: 21,
	Zstd: 22,
	WebP: 23,
	DWAA: 24,
	DWAB: 25,
	BC7: 26,
	BC5: 27
}, Ot = {
	Undefined: 0,
	Affine: 1,
	AffineProjection: 2,
	ScaleRotateTranslate: 3,
	Perspective: 4,
	PerspectiveProjection: 5,
	BilinearForward: 6,
	BilinearReverse: 7,
	Polynomial: 8,
	Arc: 9,
	Polar: 10,
	DePolar: 11,
	Cylinder2Plane: 12,
	Plane2Cylinder: 13,
	Barrel: 14,
	BarrelInverse: 15,
	Shepards: 16,
	Resize: 17,
	Sentinel: 18,
	RigidAffine: 19
}, kt = {
	Undefined: 0,
	LSB: 1,
	MSB: 2
}, At = {
	Undefined: 0,
	Absolute: 1,
	Fuzz: 2,
	MeanAbsolute: 3,
	MeanErrorPerPixel: 4,
	MeanSquared: 5,
	NormalizedCrossCorrelation: 6,
	PeakAbsolute: 7,
	PeakSignalToNoiseRatio: 8,
	PerceptualHash: 9,
	RootMeanSquared: 10,
	StructuralSimilarity: 11,
	StructuralDissimilarity: 12
}, jt = {
	Undefined: 0,
	Abs: 1,
	Add: 2,
	AddModulus: 3,
	And: 4,
	Cosine: 5,
	Divide: 6,
	Exponential: 7,
	GaussianNoise: 8,
	ImpulseNoise: 9,
	LaplacianNoise: 10,
	LeftShift: 11,
	Log: 12,
	Max: 13,
	Mean: 14,
	Median: 15,
	Min: 16,
	MultiplicativeNoise: 17,
	Multiply: 18,
	Or: 19,
	PoissonNoise: 20,
	Pow: 21,
	RightShift: 22,
	RootMeanSquare: 23,
	Set: 24,
	Sine: 25,
	Subtract: 26,
	Sum: 27,
	ThresholdBlack: 28,
	Threshold: 29,
	ThresholdWhite: 30,
	UniformNoise: 31,
	Xor: 32,
	InverseLog: 33
}, Mt = {
	Undefined: 0,
	Point: 1,
	Box: 2,
	Triangle: 3,
	Hermite: 4,
	Hann: 5,
	Hamming: 6,
	Blackman: 7,
	Gaussian: 8,
	Quadratic: 9,
	Cubic: 10,
	Catrom: 11,
	Mitchell: 12,
	Jinc: 13,
	Sinc: 14,
	SincFast: 15,
	Kaiser: 16,
	Welch: 17,
	Parzen: 18,
	Bohman: 19,
	Bartlett: 20,
	Lagrange: 21,
	Lanczos: 22,
	LanczosSharp: 23,
	Lanczos2: 24,
	Lanczos2Sharp: 25,
	Robidoux: 26,
	RobidouxSharp: 27,
	Cosine: 28,
	Spline: 29,
	LanczosRadius: 30,
	CubicSpline: 31,
	MagicKernelSharp2013: 32,
	MagicKernelSharp2021: 33
}, Nt = {
	Undefined: 0,
	None: 1,
	Background: 2,
	Previous: 3
}, Pt = {
	Undefined: 0,
	NoInterlace: 1,
	Line: 2,
	Plane: 3,
	Partition: 4,
	Gif: 5,
	Jpeg: 6,
	Png: 7
}, Ft = {
	Undefined: "Undefined",
	Unity: "Unity",
	Gaussian: "Gaussian",
	DoG: "DoG",
	LoG: "LoG",
	Blur: "Blur",
	Comet: "Comet",
	Binomial: "Binomial",
	Laplacian: "Laplacian",
	Sobel: "Sobel",
	FreiChen: "FreiChen",
	Roberts: "Roberts",
	Prewitt: "Prewitt",
	Compass: "Compass",
	Kirsch: "Kirsch",
	Diamond: "Diamond",
	Square: "Square",
	Rectangle: "Rectangle",
	Octagon: "Octagon",
	Disk: "Disk",
	Plus: "Plus",
	Cross: "Cross",
	Ring: "Ring",
	Peaks: "Peaks",
	Edges: "Edges",
	Corners: "Corners",
	Diagonals: "Diagonals",
	LineEnds: "LineEnds",
	LineJunctions: "LineJunctions",
	Ridges: "Ridges",
	ConvexHull: "ConvexHull",
	ThinSE: "ThinSE",
	Skeleton: "Skeleton",
	Chebyshev: "Chebyshev",
	Manhattan: "Manhattan",
	Octagonal: "Octagonal",
	Euclidean: "Euclidean",
	UserDefined: "UserDefined"
}, It = {
	Undefined: 0,
	Convolve: 1,
	Correlate: 2,
	Erode: 3,
	Dilate: 4,
	ErodeIntensity: 5,
	DilateIntensity: 6,
	IterativeDistance: 7,
	Open: 8,
	Close: 9,
	OpenIntensity: 10,
	CloseIntensity: 11,
	Smooth: 12,
	EdgeIn: 13,
	EdgeOut: 14,
	Edge: 15,
	TopHat: 16,
	BottomHat: 17,
	HitAndMiss: 18,
	Thinning: 19,
	Thicken: 20,
	Distance: 21,
	Voronoi: 22
}, Lt = {
	Undefined: 0,
	Uniform: 1,
	Gaussian: 2,
	MultiplicativeGaussian: 3,
	Impulse: 4,
	Laplacian: 5,
	Poisson: 6,
	Random: 7
}, Rt = {
	Undefined: 0,
	TopLeft: 1,
	TopRight: 2,
	BottomRight: 3,
	BottomLeft: 4,
	LeftTop: 5,
	RightTop: 6,
	RightBottom: 7,
	LeftBottom: 8
}, zt = {
	Undefined: 0,
	Point: 1,
	Replace: 2,
	Floodfill: 3,
	FillToBorder: 4,
	Reset: 5
}, q = {
	Undefined: 0,
	Saturation: 1,
	Perceptual: 2,
	Absolute: 3,
	Relative: 4
}, Bt = {
	Undefined: 0,
	Left: 1,
	Center: 2,
	Right: 3
}, J = {
	Undefined: 0,
	None: 1,
	Underline: 2,
	Overline: 3,
	LineThrough: 4
}, Vt = {
	Undefined: 0,
	Background: 1,
	Dither: 2,
	Edge: 3,
	Mirror: 4,
	Random: 5,
	Tile: 6,
	Transparent: 7,
	Mask: 8,
	Black: 9,
	Gray: 10,
	White: 11,
	HorizontalTile: 12,
	VerticalTile: 13,
	HorizontalTileEdge: 14,
	VerticalTileEdge: 15,
	CheckerTile: 16
}, Y = /* @__PURE__ */ function(e) {
	return e[e.Disabled = -1] = "Disabled", e[e.Linear = 0] = "Linear", e[e.Vng = 1] = "Vng", e[e.Ppg = 2] = "Ppg", e[e.Ahd = 3] = "Ahd", e[e.DCB = 4] = "DCB", e[e.Dht = 11] = "Dht", e[e.ModifiedAhd = 12] = "ModifiedAhd", e;
}({}), Ht = /* @__PURE__ */ function(e) {
	return e[e.Raw = 0] = "Raw", e[e.SRGB = 1] = "SRGB", e[e.AdobeRGB = 2] = "AdobeRGB", e[e.WideGamutRGB = 3] = "WideGamutRGB", e[e.KodakProPhotoRGB = 4] = "KodakProPhotoRGB", e[e.XYZ = 5] = "XYZ", e[e.ACES = 6] = "ACES", e;
}({}), Ut = class extends a {
	constructor() {
		super(Ee.Dng);
	}
	disableAutoBrightness;
	interpolationQuality;
	outputColor;
	useAutoWhitebalance;
	useCameraWhitebalance;
	getDefines() {
		let e = [];
		return this.hasValue(this.interpolationQuality) && e.push(this.createDefine("interpolation-quality", this.interpolationQuality)), this.hasValue(this.disableAutoBrightness) && e.push(this.createDefine("no-auto-bright", this.disableAutoBrightness)), this.hasValue(this.outputColor) && e.push(this.createDefine("output-color", this.outputColor)), this.hasValue(this.useCameraWhitebalance) && e.push(this.createDefine("use-camera-wb", this.useCameraWhitebalance)), this.hasValue(this.useAutoWhitebalance) && e.push(this.createDefine("use-auto-wb", this.useAutoWhitebalance)), e;
	}
}, X = class e {
	_colorSpace = g.Undefined;
	_compression = Dt.Undefined;
	_density = new me(0, 0);
	_format = Ee.Unknown;
	_height = 0;
	_interlace = Pt.Undefined;
	_orientation = Rt.Undefined;
	_quality = 0;
	_width = 0;
	get colorSpace() {
		return this._colorSpace;
	}
	get compression() {
		return this._compression;
	}
	get density() {
		return this._density;
	}
	get format() {
		return this._format;
	}
	get height() {
		return this._height;
	}
	get interlace() {
		return this._interlace;
	}
	get orientation() {
		return this._orientation;
	}
	get quality() {
		return this._quality;
	}
	get width() {
		return this._width;
	}
	constructor() {}
	read(e, t) {
		B._create((n) => {
			n.ping(e, t), this._colorSpace = n.colorSpace, this._compression = n.compression, this._density = n.density, this._format = n.format, this._height = n.height, this._interlace = n.interlace, this._orientation = n.orientation, this._quality = n.quality, this._width = n.width;
		});
	}
	static create(t, n) {
		let r = new e();
		return r.read(t, n), r;
	}
}, Wt = class {
	constructor(e) {
		this.complexOperator = e;
	}
	complexOperator;
	signalToNoiseRatio;
	_setArtifacts(e) {
		this.signalToNoiseRatio !== void 0 && e.setArtifact("complex:snr", this.signalToNoiseRatio);
	}
}, Gt = class {
	constructor(e) {
		this.method = e;
	}
	method;
	bestFit = !1;
	scale;
	viewport;
	_setArtifacts(e) {
		this.scale !== void 0 && e.setArtifact("distort:scale", this.scale.toString()), this.viewport !== void 0 && e.setArtifact("distort:viewport", this.viewport.toString());
	}
}, Kt = class extends ve {
	constructor(e) {
		let t = V._api._MontageSettings_Create(), n = V._api._MontageSettings_Dispose;
		super(t, n), e.backgroundColor !== void 0 && e.backgroundColor._use((e) => {
			V._api._MontageSettings_SetBackgroundColor(this._instance, e);
		}), e.borderColor !== void 0 && e.borderColor._use((e) => {
			V._api._MontageSettings_SetBorderColor(this._instance, e);
		}), e.borderWidth !== void 0 && V._api._MontageSettings_SetBorderWidth(this._instance, e.borderWidth), e.fillColor !== void 0 && e.fillColor._use((e) => {
			V._api._MontageSettings_SetFillColor(this._instance, e);
		}), e.font !== void 0 && E($e._getFontFileName(e.font), (e) => {
			V._api._MontageSettings_SetFont(this._instance, e);
		}), e.fontPointsize !== void 0 && V._api._MontageSettings_SetFontPointsize(this._instance, e.fontPointsize), e.frameGeometry !== void 0 && E(e.frameGeometry.toString(), (e) => {
			V._api._MontageSettings_SetFrameGeometry(this._instance, e);
		}), e.geometry !== void 0 && E(e.geometry.toString(), (e) => {
			V._api._MontageSettings_SetGeometry(this._instance, e);
		}), e.gravity !== void 0 && V._api._MontageSettings_SetGravity(this._instance, e.gravity), e.shadow !== void 0 && V._api._MontageSettings_SetShadow(this._instance, +!!e.shadow), e.strokeColor !== void 0 && e.strokeColor._use((e) => {
			V._api._MontageSettings_SetStrokeColor(this._instance, e);
		}), e.textureFileName !== void 0 && E(e.textureFileName, (e) => {
			V._api._MontageSettings_SetTextureFileName(this._instance, e);
		}), e.tileGeometry !== void 0 && E(e.tileGeometry.toString(), (e) => {
			V._api._MontageSettings_SetTileGeometry(this._instance, e);
		}), e.title !== void 0 && E(e.title, (e) => {
			V._api._MontageSettings_SetTitle(this._instance, e);
		});
	}
}, qt = class {
	backgroundColor;
	borderColor;
	borderWidth;
	fillColor;
	font;
	fontPointsize;
	frameGeometry;
	geometry;
	gravity;
	label;
	shadow;
	strokeColor;
	textureFileName;
	tileGeometry;
	title;
	transparentColor;
	_use(e) {
		let t = new Kt(this);
		return k._disposeAfterExecution(t, e);
	}
}, Jt = class {
	constructor(e, t, n) {
		this.method = e, this.kernel = t, n !== void 0 && (this.kernel += `:${n}`);
	}
	channels = h.Composite;
	convolveBias;
	convolveScale;
	iterations = 1;
	kernel;
	method;
}, Yt = class {
	constructor(e, t = 0) {
		this.minimum = e, this.maximum = t;
	}
	minimum;
	maximum;
	toString() {
		return this.maximum === 0 ? this.minimum.toString() : `${this.minimum}-${this.maximum}`;
	}
};
//#endregion
export { ee as AlphaAction, Ct as AutoThresholdMethod, ze as ChannelPerceptualHash, Ue as ChannelStatistics, h as Channels, te as ChromaticityInfo, wt as ClassType, b as ColorProfile, g as ColorSpace, ne as ColorSpaceNames, x as ColorTransformMode, Tt as ColorType, ie as CompareResult, S as CompareSettings, Et as ComplexOperator, Wt as ComplexSettings, ae as CompositeOperator, Dt as CompressionMethod, t as ConfigurationFile, r as ConfigurationFiles, de as ConnectedComponent, fe as ConnectedComponentsSettings, a as DefinesCreator, me as Density, pe as DensityUnit, Ot as DistortMethod, Gt as DistortSettings, je as DitherMethod, Y as DngInterpolation, Ht as DngOutputColor, Ut as DngReadDefines, o as DrawableAffine, s as DrawableBorderColor, c as DrawableColor, l as DrawableFillColor, u as DrawableFillOpacity, d as DrawableFillRule, et as DrawableFont, f as DrawableFontPointSize, tt as DrawableGravity, nt as DrawableLine, rt as DrawablePath, W as DrawablePoint, it as DrawableRectangle, G as DrawableRoundRectangle, at as DrawableStrokeColor, ot as DrawableStrokeDashArray, st as DrawableStrokeDashOffset, ct as DrawableStrokeWidth, ht as DrawableText, lt as DrawableTextAlignment, ut as DrawableTextAntiAlias, dt as DrawableTextDecoration, ft as DrawableTextInterlineSpacing, pt as DrawableTextInterwordSpacing, K as DrawableTextKerning, mt as DrawableTextUnderColor, St as Drawables, Ce as DrawingWand, kt as Endian, At as ErrorMetric, jt as EvaluateOperator, ke as FillRule, Mt as FilterType, Nt as GifDisposeMethod, j as Gravity, V as ImageMagick, re as ImageProfile, Pt as Interlace, Ft as Kernel, p as LogEvent, U as LogEventTypes, $e as Magick, D as MagickColor, gt as MagickColors, i as MagickDefine, C as MagickError, N as MagickErrorInfo, oe as MagickErrorSeverity, Ee as MagickFormat, Qe as MagickFormatInfo, O as MagickGeometry, B as MagickImage, Fe as MagickImageCollection, X as MagickImageInfo, I as MagickReadSettings, Ae as MagickSettings, qt as MontageSettings, It as MorphologyMethod, Jt as MorphologySettings, ve as NativeInstance, Lt as NoiseType, Le as OffsetInfo, Rt as Orientation, zt as PaintMethod, _t as PathLineToAbs, vt as PathLineToRel, yt as PathMoveToAbs, bt as PathMoveToRel, xt as Paths, L as Percentage, Be as PerceptualHash, m as PixelChannel, R as PixelCollection, Ve as PixelIntensityMethod, He as PixelInterpolateMethod, ue as Point, z as PrimaryInfo, Ze as ProgressEvent, Ne as QuantizeSettings, w as Quantum, q as RenderingIntent, We as Statistics, Bt as TextAlignment, J as TextDecoration, Yt as Threshold, ye as TypeMetric, Vt as VirtualPixelMethod, Ke as WarningEvent, Te as _getGravityEdges, M as _getGravityName, e as _isByteArray, Xe as initializeImageMagick };
