// Define Interfaces based on schemas

export interface VendorInfo {
  name: string;
  official_name?: string;
  blurb: string;
  logo?: string;
}

export interface ProductInfo {
  vendor_id?: string;
  name: string;
  blurb: string;
  line_art_svg?: string;
  line_art_96x64_png?: string;
  type: "headphones";
  subtype: "over_the_ear" | "on_ear" | "in_ear" | "earbuds";
}

export interface EQParameter {
  type: "peak_dip" | "high_shelf" | "low_shelf" | "low_pass" | "high_pass" | "band_pass" | "band_stop";
  frequency: number;
  gain_db?: number;
  q?: number;
  slope?: 6 | 12 | 18 | 24 | 30 | 36;
}

export interface EQParameters {
  gain_db: number;
  bands: EQParameter[];
}

export interface EQInfo {
  product_id?: string;
  author: string;
  details: string;
  link?: string;
  type: "parametric_eq";
  parameters: EQParameters;
}

export interface ParsedEQ {
  preamp: number;
  filters: EQParameter[];
}

export interface ParsedFilename {
  vendor: string;
  product: string;
  extra?: string;
  target: string;
}
