import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can,
  canAssignRole,
  canRemoveMember,
  canScore,
  isAtLeast,
  type ClubRole,
} from '../src/lib/permissions.ts';

const ROLES: ClubRole[] = ['member', 'admin', 'owner'];

test('участник только смотрит', () => {
  assert.equal(can('member', 'tournament:create'), false);
  assert.equal(can('member', 'tournament:close'), false);
  assert.equal(can('member', 'tournament:extend'), false);
  assert.equal(can('member', 'member:invite'), false);
  assert.equal(can('member', 'roster:archive'), false);
});

test('администратор ведёт турниры, но не стирает их', () => {
  assert.equal(can('admin', 'tournament:create'), true);
  assert.equal(can('admin', 'tournament:close'), true);
  assert.equal(can('admin', 'tournament:extend'), true);
  assert.equal(can('admin', 'member:invite'), true);
  // Досрочное завершение обратимо, удаление — нет.
  assert.equal(can('admin', 'tournament:delete'), false);
  assert.equal(can('admin', 'member:remove'), false);
});

test('владелец может всё', () => {
  const actions = [
    'club:edit',
    'club:transfer',
    'member:invite',
    'member:role',
    'member:remove',
    'roster:archive',
    'tournament:create',
    'tournament:delete',
    'tournament:close',
    'tournament:extend',
  ] as const;

  for (const action of actions) {
    assert.equal(can('owner', action), true, action);
  }
});

test('владелец не выходит из клуба, а передаёт его', () => {
  assert.equal(can('member', 'club:leave'), true);
  assert.equal(can('admin', 'club:leave'), true);
  // Единственное действие, которое роль владельца запрещает: иначе клуб
  // остался бы без владельца, а триггер в базе этого не допускает.
  assert.equal(can('owner', 'club:leave'), false);
});

test('счёт своего матча участник ведёт сам, пока турнир идёт', () => {
  assert.equal(canScore('member', { playing: true, running: true }), true);
  // Чужой матч — нет, даже пока турнир идёт.
  assert.equal(canScore('member', { playing: false, running: true }), false);
  // Свой, но турнир кончился: результат стал историей.
  assert.equal(canScore('member', { playing: true, running: false }), false);
});

test('администратору для счёта не нужно играть', () => {
  for (const role of ['admin', 'owner'] as const) {
    assert.equal(canScore(role, { playing: false, running: false }), true);
  }
});

test('роль поднимают не выше своей', () => {
  assert.equal(canAssignRole('admin', 'member', 'admin'), true);
  assert.equal(canAssignRole('admin', 'member', 'member'), true);
  // Своей роли достаточно, чужой — нет.
  assert.equal(canAssignRole('admin', 'member', 'owner'), false);
  assert.equal(canAssignRole('owner', 'admin', 'member'), true);
});

test('равного и старшего не трогают', () => {
  assert.equal(canAssignRole('admin', 'admin', 'member'), false);
  assert.equal(canAssignRole('admin', 'owner', 'member'), false);
  assert.equal(canAssignRole('member', 'member', 'admin'), false);
});

test('владельца назначает только передача клуба, не смена роли', () => {
  // Иначе владельцев стало бы двое, и отложенный триггер снёс бы транзакцию
  // уже на COMMIT — с сообщением, которого пользователю не показать.
  assert.equal(canAssignRole('owner', 'admin', 'owner'), false);
  assert.equal(canAssignRole('owner', 'member', 'owner'), false);
});

test('удаляет участников только владелец и только младших', () => {
  assert.equal(canRemoveMember('owner', 'member'), true);
  assert.equal(canRemoveMember('owner', 'admin'), true);
  // Себя тоже нет: владелец в клубе один, и роль у него старшая.
  assert.equal(canRemoveMember('owner', 'owner'), false);
  assert.equal(canRemoveMember('admin', 'member'), false);
});

test('порядок ролей не зависит от того, как их перечислили', () => {
  for (const role of ROLES) {
    assert.equal(isAtLeast(role, 'member'), true);
  }
  assert.equal(isAtLeast('member', 'admin'), false);
  assert.equal(isAtLeast('admin', 'owner'), false);
  assert.equal(isAtLeast('owner', 'admin'), true);
});
