import {Sequelize} from 'sequelize-typescript';
import path from 'path';
import {DATA_DIR} from '../utils/config';
import {Settings, Shortcut} from '../models';

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  database: 'muse',
  storage: path.join(DATA_DIR, 'db.sqlite'),
  models: [Settings, Shortcut],
  logging: false
});
