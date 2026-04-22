import config from '@/config/config';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  value?: string;
}

type FieldType = "Message" | "Alias" | "Channel" | "Room" | "Username" | "Password" | "Hub";

interface Rule {
  min: number;
  max: number;
  trim?: boolean;
  normalise?: boolean;
}

export default class Validator {
  private rules: Record<FieldType, Rule>;

  constructor() {
    this.rules = {
      Message: {
        min: 1,
        max: config.MAX_MESSAGE_LENGTH,
        trim: true,
        normalise: true
      },
      Alias: {
        min: config.MIN_ALIAS_LENGTH,
        max: config.MAX_ALIAS_LENGTH,
        trim: true,
        normalise: true
      },
      Channel: {
        min: config.MIN_CHANNEL_NAME_LENGTH,
        max: config.MAX_CHANNEL_NAME_LENGTH,
        trim: true,
        normalise: true
      },
      Room: {
        min: config.MIN_ROOM_NAME_LENGTH,
        max: config.MAX_ROOM_NAME_LENGTH,
        trim: true,
        normalise: true
      },
      Username: {
        min: config.MIN_USERNAME_LENGTH,
        max: config.MAX_USERNAME_LENGTH,
        trim: true,
        normalise: true
      },
      Password: {
        min: config.MIN_PASSWORD_LENGTH,
        max: config.MAX_PASSWORD_LENGTH,
        trim: false,
        normalise: true
      },
      Hub: {
        min: config.MIN_HUB_NAME_LENGTH,
        max: config.MAX_HUB_NAME_LENGTH,
        trim: true,
        normalise: true
      }
    };
  }

  private normalise(input: string): string {
    return input.normalize("NFC");
  }

  private clean(input: string): string {
    return input.trim();
  }

  private validatePasswordStrength(value: string, errors: string[]): void {
    if (!/[A-Z]/.test(value)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(value)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/[0-9]/.test(value)) {
      errors.push("Password must contain at least one digit");
    }
  }

  public validate(field: FieldType, input: unknown): ValidationResult {
    const errors: string[] = [];

    if (typeof input !== "string") {
      return { valid: false, errors: ["Input must be a string"] };
    }

    const rule = this.rules[field];
    let value = input;

    if (rule.normalise) {
      value = this.normalise(value);
    }
    if (rule.trim) {
      value = this.clean(value);
    }

    if (value.length < rule.min) {
      errors.push(`${field} is too short`);
    }
    if (value.length > rule.max) {
      errors.push(`${field} exceeds ${rule.max} characters`);
    }

    if (field === "Password") {
      this.validatePasswordStrength(value, errors);
    }

    return {
      valid: errors.length === 0,
      errors,
      value: errors.length === 0 ? value : undefined
    };
  }
}