import {Table, Column, PrimaryKey, Model, Default} from 'sequelize-typescript';

@Table
export default class Settings extends Model<Settings> {
  @PrimaryKey
  @Column
  guildId!: string;

  @Column
  prefix!: string;

  @Column
  channel!: string;

  @Default(false)
  @Column
  finishedSetup!: boolean;
}
