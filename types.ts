
export interface Message {
  role: 'user' | 'model';
  content: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  isPlan?: boolean;
  planData?: ProjectPlan;
  suggestedFile?: string;
  batchMode?: boolean;
}

export interface ProjectPlan {
  title: string;
  description: string;
  structure: {
    frontend: string[];
    backend: string[];
  };
}

export type AppMode = 'welcome' | 'ide';

export type FilesMap = Record<string, string>;

export interface GeneratedCode {
  html: string;
  css: string;
  js: string;
  fullContent: string;
}

export type ViewMode = 'split' | 'code' | 'preview';
export type DevicePreview = 'desktop' | 'mobile' | 'tablet';

export interface LogEntry {
  type: 'log' | 'error' | 'warn' | 'info';
  message: string;
  timestamp: string;
}
