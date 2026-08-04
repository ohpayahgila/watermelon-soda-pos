// ==================== SECURITY & ENCRYPTION ====================
// AES-256 Encryption for sensitive data

class SecurityManager {
  constructor() {
    this.encryptionKey = this.getOrCreateEncryptionKey();
  }

  getOrCreateEncryptionKey() {
    let key = sessionStorage.getItem('encryption_key');
    if (!key) {
      key = this.generateRandomKey();
      sessionStorage.setItem('encryption_key', key);
    }
    return key;
  }

  generateRandomKey() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async encryptAES256(data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(JSON.stringify(data));
    
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(this.encryptionKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      dataBuffer
    );

    const combined = new Uint8Array([...iv, ...new Uint8Array(encryptedData)]);
    return btoa(String.fromCharCode(...combined));
  }

  async decryptAES256(encryptedData) {
    try {
      const binaryData = atob(encryptedData);
      const data = new Uint8Array(binaryData.split('').map(char => char.charCodeAt(0)));

      const iv = data.slice(0, 12);
      const encrypted = data.slice(12);

      const key = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(this.encryptionKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))),
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
      );

      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(decrypted));
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  }

  maskCardNumber(cardNumber) {
    return cardNumber.replace(/\d(?=\d{4})/g, '*');
  }

  getCardLastFour(cardNumber) {
    return cardNumber.slice(-4);
  }

  validateCVV(cvv) {
    return /^\d{3,4}$/.test(cvv);
  }

  validateCardNumber(cardNumber) {
    // Luhn algorithm
    let sum = 0;
    let isEven = false;
    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i], 10);
      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
      isEven = !isEven;
    }
    return sum % 10 === 0;
  }

  hashPassword(password) {
    // Use SubtleCrypto for PBKDF2
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  }

  generateSalt() {
    return crypto.getRandomValues(new Uint8Array(16));
  }
}

// ==================== ACCESS CONTROL & PERMISSIONS ====================
class AccessControl {
  static ROLES = {
    CASHIER: 'cashier',
    MANAGER: 'manager',
    OWNER: 'owner'
  };

  static PERMISSIONS = {
    VIEW_SALES: ['cashier', 'manager', 'owner'],
    CREATE_SALE: ['cashier', 'manager', 'owner'],
    REFUND: ['manager', 'owner'],
    VOID: ['manager', 'owner'],
    MANAGE_STAFF: ['manager', 'owner'],
    VIEW_INVENTORY: ['manager', 'owner'],
    MANAGE_INVENTORY: ['manager', 'owner'],
    VIEW_ANALYTICS: ['manager', 'owner'],
    VIEW_AUDIT_LOG: ['owner'],
    PRINT_RECEIPT: ['cashier', 'manager', 'owner'],
    MANAGE_SHIFTS: ['manager', 'owner'],
    END_SHIFT: ['cashier', 'manager', 'owner']
  };

  static canPerform(userRole, action) {
    const allowedRoles = this.PERMISSIONS[action];
    if (!allowedRoles) return false;
    return allowedRoles.includes(userRole);
  }

  static enforcePermission(userRole, action) {
    if (!this.canPerform(userRole, action)) {
      throw new Error(`Access Denied: User role '${userRole}' cannot perform '${action}'`);
    }
  }

  static getAvailableFeatures(userRole) {
    const features = [];
    for (const [permission, roles] of Object.entries(this.PERMISSIONS)) {
      if (roles.includes(userRole)) {
        features.push(permission);
      }
    }
    return features;
  }
}

// ==================== PCI DSS COMPLIANCE ====================
class PCICompliance {
  static SENSITIVE_FIELDS = [
    'card_number',
    'cvv',
    'card_holder_name',
    'expiry_date'
  ];

  static logPaymentTransaction(paymentData, status) {
    // Never log sensitive data
    const safeData = {
      amount: paymentData.amount,
      method: paymentData.method,
      last_four: paymentData.card_number ? paymentData.card_number.slice(-4) : null,
      status: status,
      timestamp: new Date().toISOString()
    };
    
    // Encrypt payment log before storage
    return this.encryptPaymentLog(safeData);
  }

  static encryptPaymentLog(logData) {
    const securityManager = new SecurityManager();
    return securityManager.encryptAES256(logData);
  }

  static validatePaymentData(paymentData) {
    const errors = [];

    if (!paymentData.amount || paymentData.amount <= 0) {
      errors.push('Invalid amount');
    }

    if (paymentData.method === 'card') {
      const security = new SecurityManager();
      
      if (!security.validateCardNumber(paymentData.card_number)) {
        errors.push('Invalid card number');
      }

      if (!security.validateCVV(paymentData.cvv)) {
        errors.push('Invalid CVV');
      }

      if (!/^\d{2}\/\d{2}$/.test(paymentData.expiry_date)) {
        errors.push('Invalid expiry date (use MM/YY)');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  static sanitizePaymentData(paymentData) {
    const sanitized = { ...paymentData };
    
    // Remove sensitive fields before logging
    this.SENSITIVE_FIELDS.forEach(field => {
      delete sanitized[field];
    });

    // Keep only last 4 digits of card
    if (paymentData.card_number) {
      sanitized.card_last_four = paymentData.card_number.slice(-4);
    }

    return sanitized;
  }
}

// ==================== AUDIT LOGGING ====================
class AuditLogger {
  static async logAction(userId, action, details, ipAddress) {
    const securityManager = new SecurityManager();
    
    const auditEntry = {
      user_id: userId,
      action: action,
      details: details,
      ip_address: ipAddress,
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent
    };

    const encryptedEntry = await securityManager.encryptAES256(auditEntry);

    // Send to server
    try {
      const response = await fetch('/api/audit-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          encrypted_data: encryptedEntry,
          action: action
        })
      });

      if (!response.ok) {
        console.error('Failed to log audit entry');
      }
    } catch (error) {
      console.error('Audit logging error:', error);
      // Store locally as fallback
      const localLogs = JSON.parse(localStorage.getItem('audit_logs') || '[]');
      localLogs.push(encryptedEntry);
      localStorage.setItem('audit_logs', JSON.stringify(localLogs));
    }
  }

  static async getAuditLog(filters = {}) {
    try {
      const params = new URLSearchParams(filters);
      const response = await fetch(`/api/audit-log?${params}`, {
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('auth_token')}`
        }
      });

      if (!response.ok) throw new Error('Failed to fetch audit log');
      return await response.json();
    } catch (error) {
      console.error('Error fetching audit log:', error);
      return [];
    }
  }
}

// ==================== SESSION SECURITY ====================
class SessionSecurity {
  static SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes
  static WARNING_BEFORE_TIMEOUT = 2 * 60 * 1000; // Warn 2 minutes before

  static initializeSessionTimeout() {
    let inactivityTimer;
    let warningTimer;

    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      clearTimeout(warningTimer);

      warningTimer = setTimeout(() => {
        alert('Your session will expire in 2 minutes. Please continue using the app to stay logged in.');
      }, this.SESSION_TIMEOUT - this.WARNING_BEFORE_TIMEOUT);

      inactivityTimer = setTimeout(() => {
        this.expireSession();
      }, this.SESSION_TIMEOUT);
    };

    // Track user activity
    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keydown', resetTimer);
    document.addEventListener('click', resetTimer);

    resetTimer();
  }

  static expireSession() {
    sessionStorage.clear();
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
  }

  static secureLogout() {
    sessionStorage.clear();
    localStorage.removeItem('auth_token');
    localStorage.removeItem('encryption_key');
    window.location.href = '/login';
  }
}

// ==================== DATA PROTECTION ====================
class DataProtection {
  static async backupEncryptedData() {
    const securityManager = new SecurityManager();
    const data = {
      sales: JSON.parse(localStorage.getItem('local_sales') || '[]'),
      backup_timestamp: new Date().toISOString()
    };

    const encrypted = await securityManager.encryptAES256(data);
    const blob = new Blob([encrypted], { type: 'text/plain' });
    
    // Create downloadable backup
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watermelon-pos-backup-${Date.now()}.enc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static async restoreEncryptedData(encryptedData) {
    const securityManager = new SecurityManager();
    const decrypted = await securityManager.decryptAES256(encryptedData);
    
    if (decrypted && decrypted.sales) {
      localStorage.setItem('local_sales', JSON.stringify(decrypted.sales));
      return true;
    }
    return false;
  }

  static sanitizeInput(input) {
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  static validateInput(input, type = 'text') {
    const patterns = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      phone: /^\d{10,15}$/,
      number: /^\d+$/,
      text: /^[a-zA-Z0-9\s\-_.]+$/
    };

    return patterns[type]?.test(input) ?? true;
  }
}

export {
  SecurityManager,
  AccessControl,
  PCICompliance,
  AuditLogger,
  SessionSecurity,
  DataProtection
};