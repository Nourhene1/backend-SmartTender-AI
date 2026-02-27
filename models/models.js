// ============================================================
// models/index.js  (Sequelize - adapte à ton ORM)
// Tables nécessaires pour la sync calendrier Outlook
// ============================================================

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // ─── TABLE : tokens OAuth Microsoft par utilisateur ─────────
  const UserCalendarToken = sequelize.define('UserCalendarToken', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:       { type: DataTypes.UUID, allowNull: false },
    provider:     { type: DataTypes.STRING, defaultValue: 'microsoft' },
    accessToken:  { type: DataTypes.TEXT, allowNull: false },
    refreshToken: { type: DataTypes.TEXT, allowNull: false },
    expiresAt:    { type: DataTypes.DATE, allowNull: false },
    outlookEmail: { type: DataTypes.STRING },
    connected:    { type: DataTypes.BOOLEAN, defaultValue: true },
  }, {
    tableName: 'user_calendar_tokens',
    timestamps: true,
    indexes: [{ unique: true, fields: ['userId', 'provider'] }],
  });

  // ─── TABLE : abonnements webhook Microsoft ───────────────────
  const WebhookSubscription = sequelize.define('WebhookSubscription', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:         { type: DataTypes.UUID, allowNull: false },
    subscriptionId: { type: DataTypes.STRING, allowNull: false, unique: true },
    expiresAt:      { type: DataTypes.DATE, allowNull: false },
  }, {
    tableName: 'webhook_subscriptions',
    timestamps: true,
  });

  // ─── TABLE : événements calendrier (app + outlook fusionnés) ─
  const CalendarEvent = sequelize.define('CalendarEvent', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:      { type: DataTypes.UUID, allowNull: false },
    outlookId:   { type: DataTypes.STRING, unique: true },   // ID Microsoft Graph
    title:       { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    startDate:   { type: DataTypes.DATE, allowNull: false },
    endDate:     { type: DataTypes.DATE, allowNull: false },
    location:    { type: DataTypes.STRING },
    isAllDay:    { type: DataTypes.BOOLEAN, defaultValue: false },
    // 'app' = créé depuis ton app | 'outlook' = importé depuis Outlook
    source:      { type: DataTypes.ENUM('app', 'outlook'), defaultValue: 'app' },
    syncedAt:    { type: DataTypes.DATE },

    // Champs métier spécifiques à ton app (entretiens, interviews...)
    eventType:   { type: DataTypes.STRING },   // 'interview', 'meeting', etc.
    candidateId: { type: DataTypes.UUID },
    jobOfferId:  { type: DataTypes.UUID },
    status:      { type: DataTypes.STRING, defaultValue: 'scheduled' },
  }, {
    tableName: 'calendar_events',
    timestamps: true,
    indexes: [
      { fields: ['userId'] },
      { fields: ['startDate'] },
      { fields: ['outlookId'] },
    ],
  });

  // ─── Associations ─────────────────────────────────────────────
  WebhookSubscription.belongsTo(UserCalendarToken, { foreignKey: 'userId', sourceKey: 'userId' });
  UserCalendarToken.hasMany(WebhookSubscription, { foreignKey: 'userId', sourceKey: 'userId' });

  return { UserCalendarToken, WebhookSubscription, CalendarEvent };
};

