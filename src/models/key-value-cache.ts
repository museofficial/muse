import {Table, Column, PrimaryKey, Model} from 'sequelize-typescript';
import sequelize from 'sequelize';

@Table
export default class KeyValueCache extends Model<KeyValueCache> {
  @PrimaryKey
  @Column
  key!: string;

  @Column(sequelize.TEXT)
  value!: string;

  @Column
  expiresAt!: Date;
}
