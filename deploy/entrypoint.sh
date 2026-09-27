#!/bin/sh
# The image's first command under tini (deploy/Dockerfile): the relay's rooms
# folder made writable by the user the relay runs as, then the relay started as
# that user. It never runs as root.
#
# The image gives its own /data to the node user (uid 1000), and a volume Docker
# creates for it starts from that; but a volume a host mounts over /data is the
# host's, and at least one host documents its volumes as mounted as root's
# (deploy/HOSTING.md). So the container starts as root only for this: the folder
# made and given to node, then `setpriv` (util-linux, in every Debian image)
# drops to node and becomes the relay, keeping its process id, so tini's SIGTERM
# reaches the relay itself. Started as another user already (a host's own
# choice, or `docker run --user`), it has nothing to give away and starts the
# relay as it is.
set -eu

rooms=${ROOMS_DIR:-/data/rooms}
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$rooms"
  chown -R node:node "$rooms"
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
