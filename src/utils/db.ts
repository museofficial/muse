import {Sequelize} from 'sequelize-typescript';
import path from 'path';
import {DATA_DIR} from '../services/config.js';
import {Cache, Settings, Shortcut} from '../models/index.js';

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  database: 'muse',
  storage: path.join(DATA_DIR, 'db.sqlite'),
  models: [Cache, Settings, Shortcut],
  logging: false,
});
