require("dotenv").config();
const db = require("../db");
const { get_boat, get_load, get_boats } = require("../functions/dbFunctions");
const { Datastore } = require("@google-cloud/datastore");

// Constants
const entityKey = "Boat";
const entitiesPerPage = 3;
const boats_path = "/boats";
const base_path = process.env.BASE_PATH;

// GET / - retrieve all boats with pagination
module.exports.boats_get = async (req, res) => {
  // if offset string var provided, use, else 0
  let offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
  const boats = await get_boats(offset, entitiesPerPage);
  if (boats[1].moreResults !== Datastore.NO_MORE_RESULTS) {
    offset += entitiesPerPage;
    let next = base_path + boats_path + "?offset=" + offset;
    res.status(200).json({ boats: boats[0], next });
  } else {
    res.status(200).json({ boats: boats[0] });
  }
};

// GET /:boatId- a single boat by ID
module.exports.boat_get = async (req, res) => {
  const boat = await get_boat(req.params.boatId);
  if (boat === undefined) {
    res.status(404).json({ Error: "No boat with this boat_id exists" });
  } else {
    res.status(200).json({ id: req.params.boatId, ...boat });
  }
};

// GET /:boatId/loads - get all loads associated with boat
module.exports.boat_loads_get = async (req, res) => {
  const boat = await get_boat(req.params.boatId);
  if (boat === undefined) {
    res.status(404).json({ Error: "No boat with this boat_id exists" });
  } else {
    loads = await Promise.all(
      boat.loads.map(async (load_stub) => {
        const load = await get_load(load_stub.id);
        return {
          item: load.item,
          creation_date: load.creation_date,
          volume: load.volume,
          self: load.self,
        };
      })
    );
    res.status(200).json({
      length: boat.loads.length,
      loads,
    });
  }
};

// POST / - Create new boat
module.exports.create_boat = async (req, res) => {
  const newKey = db.datastore.key(entityKey);
  const boatData = { ...req.body };
  // If loads not provided in request, initialized emply list
  if (!boatData.loads) {
    boatData.loads = [];
  }
  // Save first to initialize the new key entry (required for ID)
  await db.datastore.save({ key: newKey, data: boatData });
  // Generate path to boat
  boatData.self = base_path + boats_path + "/" + newKey.id;
  // Save again to add the path to boat under 'self' data key
  await db.datastore.save({ key: newKey, data: boatData });
  res.status(201).json({ id: newKey.id, ...boatData });
};

// PUT /:boatId/loads/:loadId - add load to boat
module.exports.assign_load_to_boat = async (req, res) => {
  const boat = await get_boat(req.params.boatId);
  const load = await get_load(req.params.loadId);
  if (boat === undefined || load === undefined) {
    res
      .status(404)
      .json({ Error: "The specified boat and/or load does not exist" });
  } else if (load.carrier) {
    res
      .status(403)
      .json({ Error: "The load is already loaded on another boat" });
  } else {
    boat.loads.push({ id: req.params.loadId, self: load.self });
    await db.datastore.save(boat);
    load.carrier = { id: req.params.boatId, name: boat.name, self: boat.self };
    await db.datastore.save(load);
    res.status(204).send();
  }
};

// DELETE /:boatId/loads/:loadId - remove load from boat
module.exports.remove_load_from_boat = async (req, res) => {
  const boat = await get_boat(req.params.boatId);
  const load = await get_load(req.params.loadId);
  if (boat === undefined || load === undefined) {
    res.status(404).json({
      Error:
        "No boat with this boat_id is loaded with the load with this load_id",
    });
  } else if (
    // If the current boat's array of loads does NOT contain this load ID
    boat.loads.length === 0
  ) {
    res.status(404).json({
      Error:
        "No boat with this boat_id is loaded with the load with this load_id",
    });
  } else {
    boat.loads = boat.loads.filter((load) => load.id != req.params.loadId);
    await db.datastore.save(boat);
    load.carrier = null;
    await db.datastore.save(load);
    res.status(204).send();
  }
};

// DELETE /:boatId - delete a given boat
module.exports.delete_boat = async (req, res) => {
  const boat = await get_boat(req.params.boatId);
  if (boat === undefined) {
    res.status(404).json({ Error: "No boat with this boat_id exists" });
  } else {
    // Hanlde load unassignment
    boat.loads.forEach(async (load_stub) => {
      const load = await get_load(load_stub.id);
      load.carrier = null;
      await db.datastore.save(load);
    });
    // Handle boat delete
    const boatKey = db.datastore.key([
      entityKey,
      parseInt(req.params.boatId, 10),
    ]);
    await db.datastore.delete(boatKey);
    res.status(204).send();
  }
};