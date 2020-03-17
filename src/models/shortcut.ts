import {Table, Column, PrimaryKey, Model, AutoIncrement, Index} from 'sequelize-typescript';

@Table
export default class Shortcut extends Model<Shortcut> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id!: number;

  @Column
  @Index
  guildId!: string;

  @Column
  authorId!: string;

  @Column
  @Index
  shortcut!: string;

  @Column
  command!: string;
}
