export enum MemberStatus {
  Active   = 'active',
  Expired  = 'expired',
  Frozen   = 'frozen',
  Blocked  = 'blocked',
  Pending  = 'pending',
}

export enum PlanType {
  Basic      = 'basic',
  Premium    = 'premium',
  Yearly     = 'yearly',
  Quarterly  = 'quarterly',
  PT         = 'pt_package',
  Corporate  = 'corporate',
  Family     = 'family',
  Trial      = 'trial',
}

export enum PlanDurationUnit {
  Day   = 'day',
  Month = 'month',
  Year  = 'year',
}

export enum AccessDecision {
  Allow = 'ALLOW',
  Deny  = 'DENY',
}

export enum DenyReason {
  MemberExpired       = 'DENY_MEMBER_EXPIRED',
  MemberBlocked       = 'DENY_MEMBER_BLOCKED',
  NotInAllowedZone    = 'DENY_NOT_IN_ALLOWED_ZONE',
  OutsideTimeWindow   = 'DENY_OUTSIDE_TIME_WINDOW',
  Blacklisted         = 'DENY_BLACKLISTED',
  AntiPassback        = 'DENY_ANTI_PASSBACK',
  UnknownIdentity     = 'DENY_UNKNOWN_IDENTITY',
  PaymentDue          = 'DENY_PAYMENT_DUE',
  MemberFrozen        = 'DENY_MEMBER_FROZEN',
  DeviceHealthFail    = 'DENY_DEVICE_HEALTH_FAIL',
  BranchNotPermitted  = 'DENY_BRANCH_NOT_PERMITTED',
}

export enum SubjectType {
  Member  = 'member',
  Staff   = 'staff',
  Visitor = 'visitor',
}

export enum PaymentMode {
  Cash   = 'cash',
  UPI    = 'upi',
  Card   = 'card',
  Online = 'online',
  Manual = 'manual',
}

export enum StaffRole {
  Owner        = 'owner',
  Manager      = 'manager',
  Trainer      = 'trainer',
  Receptionist = 'receptionist',
  Accountant   = 'accountant',
  Cleaner      = 'cleaner',
}

export enum DeviceType {
  RFID        = 'rfid',
  Face        = 'face',
  QR          = 'qr',
  Card        = 'card',
  Fingerprint = 'fingerprint',
  Multimodal  = 'multimodal',
}

export enum DeviceProtocol {
  TCPip    = 'tcp_ip',
  Wiegand  = 'wiegand',
  RS485    = 'rs485',
}

export enum SyncState {
  Pending = 'pending',
  Synced  = 'synced',
  Failed  = 'failed',
}

export enum NotificationType {
  RenewalReminder  = 'renewal_reminder',
  FeeDue           = 'fee_due',
  PaymentSuccess   = 'payment_success',
  PlanExpiry       = 'plan_expiry',
  Promotion        = 'promotion',
  GymHoliday       = 'gym_holiday',
  BatchChange      = 'batch_change',
  TrainerMessage   = 'trainer_message',
  AttendanceConf   = 'attendance_confirmation',
  BirthdayWish     = 'birthday_wish',
}

export enum Zone {
  MainEntry    = 'main_entry',
  Cardio       = 'cardio',
  WeightArea   = 'weight_area',
  PTRoom       = 'pt_room',
  Steam        = 'steam',
  StaffRoom    = 'staff_room',
  StoreRoom    = 'store_room',
  Office       = 'office',
}
