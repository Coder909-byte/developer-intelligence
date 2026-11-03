export interface PinEvidence {
  filePath: string;
  line?: number | undefined;
  column?: number | undefined;
  excerpt?: string | undefined;
}

export interface ExtractedPin {
  signalName: string;
  pin: string;
  rawPin: string;
  componentRef?: string | undefined;
  mcuPin?: string | undefined;
  evidence: PinEvidence;
}

export interface NetlistExtraction {
  sourceFile: string;
  components: Array<{
    ref: string;
    value: string;
    footprint?: string | undefined;
  }>;
  nets: Array<{
    code?: string | undefined;
    name: string;
    nodes: Array<{
      ref: string;
      pin: string;
      pinfunction?: string | undefined;
    }>;
  }>;
  signals: Map<string, ExtractedPin>;
}

export interface FirmwareExtraction {
  sourceFile: string;
  pins: Map<string, ExtractedPin>;
}

export interface EngineeringMapSignal {
  net?: string | undefined;
  gpio: string;
  mcuPin?: string | undefined;
  component?: string | undefined;
  pin?: string | undefined;
}

export interface EngineeringMap {
  board?: string | undefined;
  mcuComponent?: string | undefined;
  signals: Record<string, EngineeringMapSignal>;
}
